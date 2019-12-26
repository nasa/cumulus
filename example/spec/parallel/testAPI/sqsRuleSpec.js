'use strict';

const fs = require('fs-extra');
const { stringUtils: { globalReplace } } = require('@cumulus/common');
const { sqs, receiveSQSMessages } = require('@cumulus/common/aws');
const { createSqsQueues, getSqsQueueMessageCounts } = require('@cumulus/api/lib/testUtils');
const { Granule } = require('@cumulus/api/models');
const { sleep } = require('@cumulus/common/util');
const {
  addCollections,
  addRules,
  addProviders,
  granulesApi: granulesApiTestUtils,
  cleanupProviders,
  cleanupCollections,
  rulesList,
  deleteRules
} = require('@cumulus/integration-tests');

const { waitForModelStatus } = require('../../helpers/apiUtils');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix
} = require('../../helpers/testUtils');

let config;
let testId;
let testSuffix;
let testDataFolder;
let ruleSuffix;
let ruleOverride;

const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';
const workflowName = 'IngestGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
const ruleDirectory = './spec/parallel/testAPI/data/rules/sqs';

let queues = {};

async function setupCollectionAndTestData() {
  const s3data = [
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
  ];

  // populate collections, providers and test data
  await Promise.all([
    uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
    addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
    addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
  ]);
}

async function cleanUp() {
  console.log(`\nDeleting rule ${ruleOverride.name}`);
  const rules = await rulesList(config.stackName, config.bucket, ruleDirectory);
  await deleteRules(config.stackName, config.bucket, rules, ruleSuffix);
  await Promise.all([
    deleteFolder(config.bucket, testDataFolder),
    cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
    cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
    sqs().deleteQueue({ QueueUrl: queues.queueUrl }).promise(),
    sqs().deleteQueue({ QueueUrl: queues.deadLetterQueueUrl }).promise()
  ]);
}

async function ingestGranule(queue) {
  const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
  // update test data filepaths
  const inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
  const granuleId = inputPayload.granules[0].granuleId;
  await sqs().sendMessage({ QueueUrl: queue, MessageBody: JSON.stringify(inputPayload) }).promise();
  return granuleId;
}

describe('The SQS rule', () => {
  let ruleList = [];

  beforeAll(async () => {
    config = await loadConfig();
    testId = createTimestampedTestId(config.stackName, 'sqsRule');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);
    const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    const provider = { id: `s3_provider${testSuffix}` };
    ruleSuffix = globalReplace(testSuffix, '-', '_');
    ruleOverride = {
      name: `MOD09GQ_006_sqsRule${ruleSuffix}`,
      collection: {
        name: collection.name,
        version: collection.version
      },
      provider: provider.id,
      workflow: workflowName,
      meta: {
        retries: 1
      }
    };

    await setupCollectionAndTestData();

    // create SQS queues and add rule
    queues = await createSqsQueues(testId);
    config.queueUrl = queues.queueUrl;

    ruleList = await addRules(config, ruleDirectory, ruleOverride);
  });

  afterAll(async () => {
    await cleanUp();
  });

  it('SQS rules are added', async () => {
    expect(ruleList.length).toBe(1);
    expect(ruleList[0].rule.value).toBe(queues.queueUrl);
    expect(ruleList[0].meta.visibilityTimeout).toBe(300);
    expect(ruleList[0].meta.retries).toBe(1);
  });

  describe('When posting messages to the configured SQS queue', () => {
    let granuleId;
    const invalidMessage = { foo: 'bar' };

    beforeAll(async () => {
      // post a valid message for ingesting a granule
      granuleId = await ingestGranule(queues.queueUrl);

      // post a non-processable message
      await sqs().sendMessage({ QueueUrl: queues.queueUrl, MessageBody: JSON.stringify(invalidMessage) }).promise();
    });

    afterAll(async () => {
      await granulesApiTestUtils.deleteGranule({ prefix: config.stackName, granuleId });
    });

    describe('If the message is processable by the workflow', () => {
      it('workflow is kicked off, and the granule from the message is successfully ingested', async () => {
        process.env.GranulesTable = `${config.stackName}-GranulesTable`;
        const granuleModel = new Granule();
        const record = await waitForModelStatus(
          granuleModel,
          { granuleId },
          'completed'
        );
        expect(record.granuleId).toBe(granuleId);
        expect(record.execution.includes(workflowName)).toBe(true);
      });
    });

    describe('If the message is unprocessable by the workflow', () => {
      it('is moved to dead-letter queue after retries', async () => {
        const sqsOptions = { numOfMessages: 10, visibilityTimeout: ruleList[0].meta.visibilityTimeout, waitTimeSeconds: 20 };
        let messages = await receiveSQSMessages(queues.deadLetterQueueUrl, sqsOptions);

        /* eslint-disable no-await-in-loop */
        for (let i = 0; i < 10 && messages.length === 0; i += 1) {
          await sleep(20 * 1000);
          console.log('wait for the message to arrive at dead-letter queue');
          messages = await receiveSQSMessages(queues.deadLetterQueueUrl, sqsOptions);
        }
        /* eslint-enable no-await-in-loop */

        expect(messages.length).toBe(1);
        // maxReceiveCount of RedrivePolicy is 3
        expect(parseInt(messages[0].Attributes.ApproximateReceiveCount, 10)).toBe(4);
        expect(messages[0].Body).toEqual(invalidMessage);
      });
    });

    it('messages are picked up and removed from source queue', async () => {
      const numberOfMessages = await getSqsQueueMessageCounts(queues.queueUrl);
      expect(numberOfMessages.numberOfMessagesAvailable).toBe(0);
      expect(numberOfMessages.numberOfMessagesNotVisible).toBe(0);
    });
  });
});
