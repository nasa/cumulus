'use strict';

const fs = require('fs-extra');
const { stringUtils: { globalReplace } } = require('@cumulus/common');
const { sqs, receiveSQSMessages } = require('@cumulus/common/aws');
const { Granule } = require('@cumulus/api/models');
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

let queueUrl;

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
  console.log(`\nDeleting ${ruleOverride.name}`);
  const rules = await rulesList(config.stackName, config.bucket, ruleDirectory);
  await deleteRules(config.stackName, config.bucket, rules, ruleSuffix);
  await Promise.all([
    deleteFolder(config.bucket, testDataFolder),
    cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
    cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
    sqs().deleteQueue({ QueueUrl: queueUrl }).promise()
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
      workflow: workflowName
    };

    await setupCollectionAndTestData();

    // create SQS queue and add rule
    const queueName = `${testId}Queue`;
    const { QueueUrl } = await sqs().createQueue({ QueueName: queueName }).promise();
    queueUrl = QueueUrl;
    config.queueUrl = queueUrl;

    ruleList = await addRules(config, ruleDirectory, ruleOverride);
  });

  afterAll(async () => {
    await cleanUp();
  });

  it('SQS rules are added', async () => {
    expect(ruleList.length).toBe(1);
    expect(ruleList[0].rule.value).toBe(queueUrl);
  });

  describe('When posting a message to the configured SQS queue', () => {
    let granuleId;

    beforeAll(async () => {
      granuleId = await ingestGranule(queueUrl);
    });

    afterAll(async () => {
      await granulesApiTestUtils.deleteGranule({ prefix: config.stackName, granuleId });
    });

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

    it('messages are picked up from the queue', async () => {
      const sqsOptions = { numOfMessages: 1, timeout: 40, waitTimeSeconds: 2 };
      const messages = await receiveSQSMessages(queueUrl, sqsOptions);
      expect(messages.length).toBe(0);
    });
  });
});
