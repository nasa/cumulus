'use strict';

const { s3 } = require('@cumulus/common/aws');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

const {
  LambdaStep,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');
const { randomString } = require('@cumulus/common/test-utils');

const { loadConfig } = require('../helpers/testUtils');
const {
  createOrUseTestStream,
  getShardIterator,
  getRecords,
  putRecordOnStream,
  tryCatchExit,
  waitForActiveStream,
  waitForTestSf
} = require('../helpers/kinesisHelpers');

const record = require('../../data/records/L2_HR_PIXC_product_0001-of-4154.json');

const granuleId = record.product.name;
const recordIdentifier = randomString();
record.identifier = recordIdentifier;

const testConfig = loadConfig();
const cnmResponseStreamName = `${testConfig.stackName}-cnmResponseStream`;

const lambdaStep = new LambdaStep();
const streamName = testConfig.streamName;

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
          path: 'cumulus-test-data/pdrs',
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

// When kinesis-type rules exist, the Cumulus lambda kinesisConsumer is
// configured to trigger workflows when new records arrive on a Kinesis
// stream. When a record appears on the stream, the kinesisConsumer lambda
// triggers workflows associated with the kinesis-type rules.
describe('The Cloud Notification Mechanism Kinesis workflow', () => {
  const maxWaitTime = 1000 * 60 * 4;
  let executionStatus;
  let s3FileHead;
  let responseStreamShardIterator;

  afterAll(async () => {
    await s3().deleteObject({
      Bucket: testConfig.buckets.private.name,
      Key: `${filePrefix}/${fileData.name}`
    }).promise();
  });

  beforeAll(async () => {
    await tryCatchExit(async () => {
      await createOrUseTestStream(streamName);
      await createOrUseTestStream(cnmResponseStreamName);

      console.log(`\nWaiting for active streams: '${streamName}' and '${cnmResponseStreamName}'.`);
      await waitForActiveStream(streamName);
      await waitForActiveStream(cnmResponseStreamName);
    });
  });

  describe('Workflow executes successfully', () => {
    let workflowExecution;

    beforeAll(async () => {
      await tryCatchExit(async () => {
        console.log(`Dropping record onto  ${streamName}, recordIdentifier: ${recordIdentifier}.`);
        await putRecordOnStream(streamName, record);

        console.log('Waiting for step function to start...');
        workflowExecution = await waitForTestSf(recordIdentifier, maxWaitTime);

        console.log(`Fetching shard iterator for response stream  '${cnmResponseStreamName}'.`);
        // get shard iterator for the response stream so we can process any new records sent to it
        responseStreamShardIterator = await getShardIterator(cnmResponseStreamName);

        console.log(`Waiting for completed execution of ${workflowExecution.executionArn}.`);
        executionStatus = await waitForCompletedExecution(workflowExecution.executionArn);
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
        expect(new Date() - s3FileHead.LastModified < maxWaitTime).toBeTruthy();
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
      await tryCatchExit(async () => {
        console.log(`Dropping bad record onto ${streamName}, recordIdentifier: ${badRecordIdentifier}.`);
        await putRecordOnStream(streamName, badRecord);

        console.log(`Fetching shard iterator for response stream  '${cnmResponseStreamName}'.`);
        // get shard iterator for the response stream so we can process any new records sent to it
        responseStreamShardIterator = await getShardIterator(cnmResponseStreamName);

        console.log('Waiting for step function to start...');
        workflowExecution = await waitForTestSf(badRecordIdentifier, maxWaitTime);

        console.log(`Waiting for completed execution of ${workflowExecution.executionArn}.`);
        executionStatus = await waitForCompletedExecution(workflowExecution.executionArn);
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
