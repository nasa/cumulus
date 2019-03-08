'use strict';

const {
  aws: { s3 },
  stringUtils: { globalReplace }
} = require('@cumulus/common');
const { Execution } = require('@cumulus/api/models');
const fs = require('fs');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 9 * 60 * 1000;

const {
  getEventSourceMapping,
  addRules,
  LambdaStep,
  waitForCompletedExecution,
  addProviders,
  cleanupProviders,
  addCollections,
  cleanupCollections,
  rulesList,
  deleteRules
} = require('@cumulus/integration-tests');
const { randomString } = require('@cumulus/common/test-utils');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix
} = require('../../helpers/testUtils');

const {
  createOrUseTestStream,
  deleteTestStream,
  getShardIterator,
  getStreamStatus,
  getRecords,
  putRecordOnStream,
  tryCatchExit,
  waitForActiveStream,
  waitForTestSf
} = require('../../helpers/kinesisHelpers');

const testConfig = loadConfig();
const testId = createTimestampedTestId(testConfig.stackName, 'KinesisTestTrigger');
const testSuffix = createTestSuffix(testId);
const testDataFolder = createTestDataPath(testId);
const ruleSuffix = globalReplace(testSuffix, '-', '_');


const record = JSON.parse(fs.readFileSync(`${__dirname}/data/records/L2_HR_PIXC_product_0001-of-4154.json`));

record.product.files[0].uri = globalReplace(record.product.files[0].uri, 'cumulus-test-data/pdrs', testDataFolder);
record.provider += testSuffix;
record.collection += testSuffix;

const granuleId = record.product.name;
const recordIdentifier = randomString();
record.identifier = recordIdentifier;

const lambdaStep = new LambdaStep();

const recordFile = record.product.files[0];
const expectedTranslatePayload = {
  cnm: {
    product: record.product,
    identifier: recordIdentifier,
    bucket: record.bucket,
    provider: record.provider,
    collection: record.collection
  },
  granules: [
    {
      granuleId: record.product.name,
      files: [
        {
          path: testDataFolder,
          url_path: recordFile.uri,
          bucket: record.bucket,
          name: recordFile.name,
          size: recordFile.size
        }
      ]
    }
  ]
};

const fileData = expectedTranslatePayload.granules[0].files[0];
const filePrefix = `file-staging/${testConfig.stackName}/${record.collection}___000`;

const fileDataWithFilename = {
  ...fileData,
  filename: `s3://${testConfig.buckets.private.name}/${filePrefix}/${recordFile.name}`,
  bucket: testConfig.buckets.private.name,
  url_path: '',
  fileStagingDir: filePrefix
};

const expectedSyncGranulesPayload = {
  granules: [
    {
      granuleId: granuleId,
      dataType: record.collection,
      version: '000',
      files: [fileDataWithFilename]
    }
  ]
};

const ruleDirectory = './spec/parallel/kinesisTests/data/rules';
const ruleOverride = {
  name: `L2_HR_PIXC_kinesisRule${ruleSuffix}`,
  collection: {
    name: record.collection,
    version: '000'
  },
  provider: record.provider
};

const s3data = ['@cumulus/test-data/granules/L2_HR_PIXC_product_0001-of-4154.h5'];

process.env.ExecutionsTable = `${testConfig.prefix}-ExecutionsTable`;

// When kinesis-type rules exist, the Cumulus lambda messageConsumer is
// configured to trigger workflows when new records arrive on a Kinesis
// stream. When a record appears on the stream, the messageConsumer lambda
// triggers workflows associated with the kinesis-type rules.
describe('The Cloud Notification Mechanism Kinesis workflow', () => {
  const maxWaitForSFExistSecs = 60 * 4;
  const maxWaitForExecutionSecs = 60 * 5;
  let executionStatus;
  let s3FileHead;
  let responseStreamShardIterator;
  let logEventSourceMapping;

  const providersDir = './data/providers/PODAAC_SWOT/';
  const collectionsDir = './data/collections/L2_HR_PIXC-000/';

  const streamName = `${testId}-KinesisTestTriggerStream`;
  const cnmResponseStreamName = `${testId}-KinesisTestTriggerCnmResponseStream`;
  testConfig.streamName = streamName;
  testConfig.cnmResponseStream = cnmResponseStreamName;


  async function cleanUp() {
    // delete rule
    console.log(`\nDeleting ${ruleOverride.name}`);
    const rules = await rulesList(testConfig.stackName, testConfig.bucket, ruleDirectory);
    // clean up stack state added by test
    console.log(`\nCleaning up stack & deleting test streams '${streamName}' and '${cnmResponseStreamName}'`);
    await deleteRules(testConfig.stackName, testConfig.bucket, rules, ruleSuffix);
    await Promise.all([
      deleteFolder(testConfig.bucket, testDataFolder),
      cleanupCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      cleanupProviders(testConfig.stackName, testConfig.bucket, providersDir, testSuffix),
      deleteTestStream(streamName),
      deleteTestStream(cnmResponseStreamName),
      s3().deleteObject({
        Bucket: testConfig.buckets.private.name,
        Key: `${filePrefix}/${fileData.name}`
      }).promise()
    ]);
  }

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(testConfig.bucket, s3data, testDataFolder),
      addCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      addProviders(testConfig.stackName, testConfig.bucket, providersDir, testConfig.bucket, testSuffix)
    ]);
    // create streams
    await tryCatchExit(cleanUp, async () => {
      await Promise.all([
        createOrUseTestStream(streamName),
        createOrUseTestStream(cnmResponseStreamName)
      ]);
      console.log(`\nWaiting for active streams: '${streamName}' and '${cnmResponseStreamName}'.`);
      await Promise.all([
        waitForActiveStream(streamName),
        waitForActiveStream(cnmResponseStreamName)
      ]);
      const ruleList = await addRules(testConfig, ruleDirectory, ruleOverride);
      logEventSourceMapping = await getEventSourceMapping(ruleList[0].rule.logEventArn);
    });
  });

  afterAll(async () => {
    await cleanUp();
  });

  it('Creates an event to log incoming records', async () => {
    const mapping = logEventSourceMapping;
    expect(mapping.FunctionArn.endsWith(`${testConfig.prefix}-KinesisInboundEventLogger`)).toBe(true);
    expect(mapping.EventSourceArn.endsWith(streamName)).toBe(true);
  });

  it('Prepares a kinesis stream for integration tests.', async () => {
    expect(await getStreamStatus(streamName)).toBe('ACTIVE');
  });

  describe('Workflow executes successfully', () => {
    let workflowExecution;

    beforeAll(async () => {
      await tryCatchExit(cleanUp, async () => {
        console.log(`Dropping record onto  ${streamName}, recordIdentifier: ${recordIdentifier}`);
        await putRecordOnStream(streamName, record);

        console.log('Waiting for step function to start...');
        workflowExecution = await waitForTestSf(recordIdentifier, maxWaitForSFExistSecs);

        console.log(`Waiting for completed execution of ${workflowExecution.executionArn}`);
        executionStatus = await waitForCompletedExecution(workflowExecution.executionArn, maxWaitForExecutionSecs);
      });
    });

    it('executes successfully', () => {
      expect(executionStatus).toEqual('SUCCEEDED');
    });

    describe('the TranslateMessage Lambda', () => {
      let lambdaOutput;
      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'CNMToCMA');
      });

      it('outputs the expectedTranslatePayload object', () => {
        expect(lambdaOutput.payload).toEqual(expectedTranslatePayload);
      });
    });

    describe('the execution record', () => {
      let startStep;
      let endStep;
      beforeAll(async () => {
        startStep = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SfSnsReport');
        endStep = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'sf2snsEnd');
      });

      it('records both the original and the final payload', async () => {
        const execution = new Execution();
        const executionRecord = await execution.get({ arn: workflowExecution.executionArn });
        expect(executionRecord.originalPayload).toEqual(startStep.payload);
        expect(executionRecord.finalPayload).toEqual(endStep.payload);
      });
    });

    describe('the SyncGranule Lambda', () => {
      let lambdaOutput;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
      });

      it('outputs the granules object', () => {
        expect(lambdaOutput.payload).toEqual(expectedSyncGranulesPayload);
      });

      it('syncs data to s3 target location.', async () => {
        s3FileHead = await s3().headObject({
          Bucket: testConfig.buckets.private.name,
          Key: `${filePrefix}/${fileData.name}`
        }).promise();
        expect(new Date() - s3FileHead.LastModified < maxWaitForSFExistSecs * 1000).toBeTruthy();
      });
    });

    describe('the CnmResponse Lambda', () => {
      let lambdaOutput;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'CnmResponse');
      });

      it('outputs the expected object', () => {
        const actualPayload = lambdaOutput.payload;
        delete actualPayload.processCompleteTime;

        expect(actualPayload).toEqual({
          productSize: recordFile.size,
          bucket: record.bucket,
          collection: record.collection,
          provider: record.provider,
          identifier: recordIdentifier,
          response: {
            status: 'SUCCESS'
          }
        });
      });

      it('writes a message to the response stream', async () => {
        console.log(`Fetching shard iterator for response stream  '${cnmResponseStreamName}'`);
        responseStreamShardIterator = await getShardIterator(cnmResponseStreamName);
        const newResponseStreamRecords = await getRecords(responseStreamShardIterator);
        const parsedRecords = newResponseStreamRecords.map((r) => JSON.parse(r.Data.toString()));
        const responseRecord = parsedRecords.find((r) => r.identifier === recordIdentifier);
        expect(responseRecord.identifier).toEqual(recordIdentifier);
        expect(responseRecord.response.status).toEqual('SUCCESS');
      });
    });
  });

  describe('Workflow fails because TranslateMessage fails', () => {
    let workflowExecution;
    const badRecord = { ...record };
    const badRecordIdentifier = randomString();
    badRecord.identifier = badRecordIdentifier;
    delete badRecord.product;

    beforeAll(async () => {
      await tryCatchExit(cleanUp, async () => {
        console.log(`Dropping bad record onto ${streamName}, recordIdentifier: ${badRecordIdentifier}.`);
        await putRecordOnStream(streamName, badRecord);

        console.log('Waiting for step function to start...');
        workflowExecution = await waitForTestSf(badRecordIdentifier, maxWaitForSFExistSecs);

        console.log(`Waiting for completed execution of ${workflowExecution.executionArn}.`);
        executionStatus = await waitForCompletedExecution(workflowExecution.executionArn, maxWaitForExecutionSecs);
      });
    });

    it('executes but fails', () => {
      expect(executionStatus).toEqual('FAILED');
    });

    it('sends the error to the CnmResponse task', async () => {
      const CnmResponseInput = await lambdaStep.getStepInput(workflowExecution.executionArn, 'CnmResponse');
      expect(CnmResponseInput.exception.Error).toEqual('cumulus_message_adapter.message_parser.MessageAdapterException');
      expect(JSON.parse(CnmResponseInput.exception.Cause).errorMessage).toMatch(/An error occurred in the Cumulus Message Adapter: .+/);
    });

    it('outputs the record', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'CnmResponse', 'failure');
      expect(lambdaOutput.error).toEqual('cumulus_message_adapter.message_parser.MessageAdapterException');
      expect(lambdaOutput.cause).toMatch(/.+An error occurred in the Cumulus Message Adapter: .+/);
      expect(lambdaOutput.cause).not.toMatch(/.+process hasn't exited.+/);
    });

    it('writes a failure message to the response stream', async () => {
      console.log(`Fetching shard iterator for response stream  '${cnmResponseStreamName}'.`);
      responseStreamShardIterator = await getShardIterator(cnmResponseStreamName);
      const newResponseStreamRecords = await getRecords(responseStreamShardIterator);
      if (newResponseStreamRecords.length > 0) {
        const parsedRecords = newResponseStreamRecords.map((r) => JSON.parse(r.Data.toString()));
        // TODO(aimee): This should check the record identifier is equal to bad
        // record identifier, but this requires a change to cnmresponse task
        expect(parsedRecords[parsedRecords.length - 1].response.status).toEqual('FAILURE');
      }
      else {
        fail(`unexpected error occurred and no messages found in ${cnmResponseStreamName}. Did the "ouputs the record" above fail?`);
      }
    });
  });
});
