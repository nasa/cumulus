'use strict';

const fs = require('fs-extra');
const replace = require('lodash/replace');

const { createSqsQueues } = require('@cumulus/api/lib/testUtils');
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
const { deleteExecution, getExecution } = require('@cumulus/api-client/executions');
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
  setProcessEnvironment,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');

const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  buildAndExecuteWorkflow,
} = require('../../helpers/workflowUtils');

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
let ruleOverride;
let ruleSuffix;
let getCnmExecutionRecord;
let testDataFolder;
let testSuffix;
let cnmResponseStream;
let granuleId;
let collection;
let queues = {};

const workflowExecutionArns = [];
const collectionsDir = './data/collections/ASCATB-L2-Coastal';
const providersDir = './data/providers/PO.DAAC/';
const workflowName = 'CNMExampleWorkflow';
const ruleDirectory = './spec/parallel/cnmWorkflow/data/rules/sqs';
const s3data = [
  '@cumulus/test-data/granules/ascat_20121029_010301_metopb_00588_eps_o_coa_2101_ovw.l2.nc',
];
const passthroughWorkflowName = 'Passthrough';

async function cleanUp() {
  setProcessEnvironment(config.stackName, config.bucket);
  const rules = await readJsonFilesFromDir(ruleDirectory);
  await deleteRules(config.stackName, config.bucket, rules, ruleSuffix);
  await Promise.all(
    workflowExecutionArns
      .map((arn) => deleteExecution({ prefix: config.stackName, executionArn: arn }))
  );
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

describe('The Get CNM workflow setup', () => {
  let collections;
  let providers;
  let executionNamePrefix;
  let record;
  let scheduleQueueUrl;
  let workflowArn;

  const executionStatuses = [];
  const maxWaitForExecutionSecs = 60 * 5;
  const maxWaitForSFExistSecs = 60 * 4;

  beforeAll(async () => {
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
    await uploadTestDataToBucket(config.bucket, s3data, testDataFolder);
    collections = await addCollections(config.stackName, config.bucket, collectionsDir, testSuffix);
    providers = await addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix);

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

    await addRules(config, ruleDirectory, ruleOverride);
  });

  describe('is triggered successfully and resulting get cnm workflow triggered successfully', () => {
    beforeAll(async () => {
      await sendSQSMessage(queues.sourceQueueUrl, record);
      let workflowExecution = await waitForTestSfForRecord(record.identifier, workflowArn, maxWaitForSFExistSecs);
      workflowExecutionArns.push(workflowExecution.executionArn);

      const executionStatus = await waitForCompletedExecution(workflowExecution.executionArn, maxWaitForExecutionSecs);
      executionStatuses.push(executionStatus);

      const meta = {};
      meta.collection = collection;

      const granule = getGranule(record);
      granule.dataType = collection.name;
      granule.version = collection.version;
      granule.granuleId = granuleId;

      for (let index = 0; index < 3; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName,
          config.bucket,
          passthroughWorkflowName,
          collections[0],
          providers[0],
          { granules: [granule] },
          meta
        );
        executionStatuses.push(workflowExecution.status);
        workflowExecutionArns.push(workflowExecution.executionArn);
      }

      const getCnmWorkflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        'GetCnmWorkflow',
        collections[0],
        providers[0],
        { granules: [granule] },
        meta
      );
      const getCnmExecutionArn = getCnmWorkflowExecution.executionArn;
      executionStatuses.push(getCnmWorkflowExecution.status);
      workflowExecutionArns.push(getCnmExecutionArn);

      getCnmExecutionRecord = await getExecution({
        prefix: config.stackName,
        arn: getCnmExecutionArn,
      });
    });

    it('all workflows execute successfully', () => {
      expect(executionStatuses.every((status) => ['SUCCEEDED', 'completed'].includes(status))).toBe(true);
    });

    it('the get CNM workflowsuccessfully retrieves the original CNM message', () => {
      const returnedCnmMessage = getCnmExecutionRecord.finalPayload[granuleId];

      expect(returnedCnmMessage).toBeDefined();
      expect(returnedCnmMessage).toEqual(record);
    });
    afterAll(async () => {
      await cleanUp();
    });
  });
});
