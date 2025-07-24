'use strict';

const fs = require('fs-extra');
const replace = require('lodash/replace');
const pWaitFor = require('p-wait-for');

const { createSqsQueues, getSqsQueueMessageCounts } = require('@cumulus/api/lib/testUtils');
const { sns } = require('@cumulus/aws-client/services');
const {
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const { getJsonS3Object } = require('@cumulus/aws-client/S3');
const {
  deleteQueue,
  getQueueUrlByName,
  sendSQSMessage,
} = require('@cumulus/aws-client/SQS');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { getGranule, removePublishedGranule } = require('@cumulus/api-client/granules');
const { randomId } = require('@cumulus/common/test-utils');
const { getWorkflowFileKey } = require('@cumulus/common/workflows');

const {
  addCollections,
  addRules,
  addProviders,
  cleanupCollections,
  cleanupProviders,
  readJsonFilesFromDir,
  deleteRules,
  getExecutionInputObject,
  setProcessEnvironment,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');

const { constructCollectionId } = require('@cumulus/message/Collections');

const { waitForApiStatus } = require('../../helpers/apiUtils');
const { waitForTestSfForRecord } = require('../../helpers/kinesisHelpers');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  timestampedName,
} = require('../../helpers/testUtils');

let config;
let executionArn;
let ruleOverride;
let ruleSuffix;
let testDataFolder;
let testSuffix;
let cnmResponseStream;
let granuleId;
let collection;
let queues = {};
let workflowExecution;

const collectionsDir = './data/collections/ASCATB-L2-Coastal';
const providersDir = './data/providers/PO.DAAC/';

const workflowName = 'CNMExampleWorkflow';

const ruleDirectory = './spec/parallel/cnmWorkflow/data/rules/sqs';

const s3data = [
  '@cumulus/test-data/granules/ascat_20121029_010301_metopb_00588_eps_o_coa_2101_ovw.l2.nc',
];

async function cleanUp() {
  setProcessEnvironment(config.stackName, config.bucket);
  console.log(`\nDeleting rule ${ruleOverride.name}`);
  const rules = await readJsonFilesFromDir(ruleDirectory);
  await deleteRules(config.stackName, config.bucket, rules, ruleSuffix);
  await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn });
  await removePublishedGranule({ prefix: config.stackName,
    granuleId,
    collectionId: constructCollectionId(ruleOverride.collection.name, ruleOverride.collection.version) });

  await Promise.all([
    deleteFolder(config.bucket, testDataFolder),
    deleteQueue(queues.sourceQueueUrl),
    deleteQueue(queues.deadLetterQueueUrl),
    sns().send(new DeleteTopicCommand({ TopicArn: cnmResponseStream })),
    cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
    cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
  ]);
}

const waitForQueueMessageCount = (queueUrl, expectedCount) =>
  pWaitFor(
    async () => {
      const {
        numberOfMessagesAvailable,
        numberOfMessagesNotVisible,
      } = await getSqsQueueMessageCounts(queueUrl);
      return numberOfMessagesAvailable === expectedCount &&
        numberOfMessagesNotVisible === expectedCount;
    },
    {
      interval: 3000,
      timeout: 60 * 1000,
    }
  );

describe('The Cloud Notification Mechanism SQS workflow', () => {
  let beforeAllFailed;
  let executionNamePrefix;
  let executionStatus;
  let record;
  let ruleList;
  let scheduleQueueUrl;
  let workflowArn;

  const maxWaitForExecutionSecs = 60 * 5;
  const maxWaitForSFExistSecs = 60 * 4;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      const testId = createTimestampedTestId(config.stackName, 'CnmSqsTest');
      testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);
      ruleSuffix = replace(testSuffix, /-/g, '_');

      const workflowDefinition = await getJsonS3Object(
        config.bucket,
        getWorkflowFileKey(config.stackName, workflowName)
      );
      workflowArn = workflowDefinition.arn;

      record = JSON.parse(fs.readFileSync(`${__dirname}/data/records/ascat_20121029_010301_metopb_00588_eps_o_coa_2101_ovw.l2.json`));

      record.product.files.forEach((file) => {
        file.uri = replace(
          file.uri,
          /<replace-bucket>\/cumulus-test-data\/pdrs/g,
          `${config.bucket}/${testDataFolder}`
        );
      });
      record.provider += testSuffix;
      record.collection += testSuffix;
      record.product.name += testSuffix;

      granuleId = record.product.name;
      record.identifier = randomId('identifier');

      executionNamePrefix = randomId(3);

      scheduleQueueUrl = await getQueueUrlByName(`${config.stackName}-backgroundProcessing`);

      collection = {
        name: record.collection,
        version: record.product.dataVersion,
      };
      ruleOverride = {
        name: `ASCATB_L2_Coastal_CnmSqsTestRule${ruleSuffix}`,
        collection,
        provider: record.provider,
        executionNamePrefix,
        // use custom queue for scheduling workflows
        queueUrl: scheduleQueueUrl,
      };

      // populate collections, providers and test data
      await Promise.all([
        uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
        addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
      ]);

      // create SQS queues and add rule
      const { queueUrl, deadLetterQueueUrl } = await createSqsQueues(testId);
      queues = {
        sourceQueueUrl: queueUrl,
        deadLetterQueueUrl,
        scheduleQueueUrl,
      };
      config.queueUrl = queues.sourceQueueUrl;

      // create SNS topic for cnm response
      const snsTopicName = timestampedName(`${config.stackName}_CnmSqsTestTopic`);
      const { TopicArn } = await createSnsTopic(snsTopicName);
      cnmResponseStream = TopicArn;
      config.cnmResponseStream = cnmResponseStream;

      ruleList = await addRules(config, ruleDirectory, ruleOverride);
    } catch (error) {
      console.log('beforeAll error', error);
      beforeAllFailed = error;
    }
  });

  afterAll(async () => {
    await cleanUp();
  });

  it('SQS rule is added for collection with version containing slashes', () => {
    if (beforeAllFailed) fail(beforeAllFailed);
    expect(ruleList.length).toBe(1);
    expect(ruleList[0].rule.value).toBe(queues.sourceQueueUrl);
  });

  describe('workflow is triggered successfully', () => {
    beforeAll(async () => {
      if (beforeAllFailed) return;
      try {
        console.log(`Dropping record onto  ${queues.sourceQueueUrl}, record.identifier: ${record.identifier}`);
        await sendSQSMessage(queues.sourceQueueUrl, record);
        console.log('Waiting for step function to start...');
        workflowExecution = await waitForTestSfForRecord(record.identifier, workflowArn, maxWaitForSFExistSecs);

        console.log(`Waiting for completed execution of ${workflowExecution.executionArn}`);
        executionStatus = await waitForCompletedExecution(workflowExecution.executionArn, maxWaitForExecutionSecs);
      } catch (error) {
        console.log('beforeAll error', error);
        beforeAllFailed = error;
      }
    });

    it('executes successfully', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(executionStatus).toEqual('SUCCEEDED');
    });

    it('creates an execution with the correct prefix', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const executionName = workflowExecution.executionArn.split(':').reverse()[0];
      expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
    });

    describe('the granule record', () => {
      beforeAll(async () => {
        if (beforeAllFailed) return;
        try {
          record = await waitForApiStatus(
            getGranule,
            {
              prefix: config.stackName,
              granuleId,
              collectionId: constructCollectionId(record.collection, record.product.dataVersion),
            },
            'completed'
          );
        } catch (error) {
          console.log('beforeAll error', error);
          beforeAllFailed = error;
        }
      });

      it('the granule from the message is successfully ingested', () => {
        if (beforeAllFailed) fail(beforeAllFailed);
        expect(record.granuleId).toBe(granuleId);
        expect(record.execution).toContain(workflowName);
      });

      it('the execution name starts with the expected prefix', () => {
        if (beforeAllFailed) fail(beforeAllFailed);
        const executionName = record.execution.split(':').reverse()[0];
        expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
      });

      it('references the correct queue URL in the execution message', async () => {
        if (beforeAllFailed) fail(beforeAllFailed);
        executionArn = record.execution.split('/').reverse()[0];
        const executionInput = await getExecutionInputObject(executionArn);
        expect(executionInput.cumulus_meta.queueUrl).toBe(queues.scheduleQueueUrl);
      });
    });

    it('messages are picked up and removed from source queue', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      await expectAsync(waitForQueueMessageCount(queues.sourceQueueUrl, 0)).toBeResolved();
    });
  });
});
