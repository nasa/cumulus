'use strict';

const {
  aws: { s3 },
  stringUtils: { globalReplace }
} = require('@cumulus/common');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 12 * 60 * 1000;

const {
  addRules,
  LambdaStep,
  waitForCompletedExecution,
  rulesList,
  deleteRules
} = require('@cumulus/integration-tests');
const { randomString } = require('@cumulus/common/test-utils');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  timestampedTestDataPrefix
} = require('../helpers/testUtils');

const {
  createOrUseTestStream,
  deleteTestStream,
  getShardIterator,
  getStreamStatus,
  getRecords,
  putRecordOnStream,
  timeStampedStreamName,
  tryCatchExit,
  waitForActiveStream,
  waitForTestSf
} = require('../helpers/kinesisHelpers');

const testConfig = loadConfig();

const record = require('./data/records/L2_HR_PIXC_product_0001-of-4154.json');

const testDataFolder = timestampedTestDataPrefix(`${testConfig.stackName}-KinesisTestTrigger`);

record.product.files[0].uri = globalReplace(record.product.files[0].uri, 'cumulus-test-data/pdrs', testDataFolder);

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
const filePrefix = `file-staging/${testConfig.stackName}/L2_HR_PIXC___000`;

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
      dataType: 'L2_HR_PIXC',
      version: '000',
      files: [fileDataWithFilename]
    }
  ]
};

const ruleDirectory = './spec/kinesisTests/data/rules';

const s3data = ['@cumulus/test-data/granules/L2_HR_PIXC_product_0001-of-4154.h5'];

// When kinesis-type rules exist, the Cumulus lambda kinesisConsumer is
// configured to trigger workflows when new records arrive on a Kinesis
// stream. When a record appears on the stream, the kinesisConsumer lambda
// triggers workflows associated with the kinesis-type rules.
describe('The Cloud Notification Mechanism Kinesis workflow', () => {
  const maxWaitForSFExistSecs =  60 * 4;
  const maxWaitForExecutionSecs = 60 * 8;
  let executionStatus;
  let s3FileHead;
  let responseStreamShardIterator;

  const streamName = timeStampedStreamName(testConfig, 'KinesisTestTriggerStream');
  const cnmResponseStreamName = timeStampedStreamName(testConfig, 'KinesisTestTriggerCnmResponseStream');
  testConfig.streamName = streamName;
  testConfig.cnmResponseStream = cnmResponseStreamName;


  async function cleanUp() {
    // delete rule
    const rules = await rulesList(testConfig.stackName, testConfig.bucket, ruleDirectory);
    await deleteRules(testConfig.stackName, testConfig.bucket, rules);
    // delete uploaded test data
    await deleteFolder(testConfig.bucket, testDataFolder);
    // delete synced data
    await s3().deleteObject({
      Bucket: testConfig.buckets.private.name,
      Key: `${filePrefix}/${fileData.name}`
    }).promise();
    console.log(`\nDeleting test streams '${streamName}' and '${cnmResponseStreamName}'`);
    await Promise.all([deleteTestStream(streamName), deleteTestStream(cnmResponseStreamName)]);
  }

  beforeAll(async () => {
    await uploadTestDataToBucket(testConfig.bucket, s3data, testDataFolder);
    // create streams
    await tryCatchExit(cleanUp, async () => {
      await createOrUseTestStream(streamName);
      await createOrUseTestStream(cnmResponseStreamName);
      console.log(`\nWaiting for active streams: '${streamName}' and '${cnmResponseStreamName}'.`);
      await waitForActiveStream(streamName);
      await waitForActiveStream(cnmResponseStreamName);
      console.log('\nSetting up kinesisRule');
      await addRules(testConfig, ruleDirectory);
    });
  });

  afterAll(async () => {
    await cleanUp();
  });

  it('Prepares a kinesis stream for integration tests.', async () => {
    expect(await getStreamStatus(streamName)).toBe('ACTIVE');
  });

  describe('Workflow executes successfully', () => {
    let workflowExecution;

    beforeAll(async () => {
      await tryCatchExit(cleanUp, async () => {
        console.log(`Dropping record onto  ${streamName}, recordIdentifier: ${recordIdentifier}.`);
        await putRecordOnStream(streamName, record);

        console.log('Waiting for step function to start...');
        workflowExecution = await waitForTestSf(recordIdentifier, maxWaitForSFExistSecs);

        console.log(`Fetching shard iterator for response stream  '${cnmResponseStreamName}'.`);
        // get shard iterator for the response stream so we can process any new records sent to it
        responseStreamShardIterator = await getShardIterator(cnmResponseStreamName);

        console.log(`Waiting for completed execution of ${workflowExecution.executionArn}.`);
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
        const newResponseStreamRecords = await getRecords(responseStreamShardIterator);
        const parsedRecords = newResponseStreamRecords.Records.map((r) => JSON.parse(r.Data.toString()));
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

        console.log(`Fetching shard iterator for response stream  '${cnmResponseStreamName}'.`);
        // get shard iterator for the response stream so we can process any new records sent to it
        responseStreamShardIterator = await getShardIterator(cnmResponseStreamName);

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
    });

    it('writes a failure message to the response stream', async () => {
      const newResponseStreamRecords = await getRecords(responseStreamShardIterator);
      const parsedRecords = newResponseStreamRecords.Records.map((r) => JSON.parse(r.Data.toString()));
      // TODO(aimee): This should check the record identifier is equal to bad
      // record identifier, but this requires a change to cnmresponse task
      expect(parsedRecords[parsedRecords.length - 1].response.status).toEqual('FAILURE');
    });
  });
});
