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
  putRecordOnStream,
  waitForActiveStream,
  waitForTestSfStarted
} = require('../helpers/kinesisHelpers');

const record = require('../../data/records/L2_HR_PIXC_product_0001-of-4154.json');

const granuleId = record.product.name;
const recordIdentifier = randomString();
record.identifier = recordIdentifier;

const testConfig = loadConfig();

const lambdaStep = new LambdaStep();
const streamName = testConfig.streamName;


const recordFile = record.product.files[0];
const expectedTranslatePayload = {
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
const filePrefix = `file-staging/${testConfig.stackName}/L2_HR_PIXC`;

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

  afterAll(async () => {
    await s3().deleteObject({
      Bucket: testConfig.buckets.private.name,
      Key: `${filePrefix}/${fileData.name}`
    }).promise();
  });


  beforeAll(async () => {
    try {
      await createOrUseTestStream(streamName);
      console.log(`\nwaits for active Stream ${streamName}.`);
      await waitForActiveStream(streamName);
      console.log(`Drops record onto  ${streamName}.`);
      await putRecordOnStream(streamName, record);
      console.log(`waits for stepfunction to start ${streamName}`);
      this.workflowExecution = await waitForTestSfStarted(recordIdentifier, maxWaitTime);
      console.log(`waits for completed execution of ${this.workflowExecution.executionArn}.`);
      executionStatus = await waitForCompletedExecution(this.workflowExecution.executionArn);
    }
    catch (error) {
      console.log(error);
      console.log('Tests conditions can\'t get met...exiting.');
      process.exit(1);
    }
  });

  it('executes successfully', () => {
    expect(executionStatus).toEqual('SUCCEEDED');
  });

  describe('the TranslateMessage Lambda', () => {
    beforeAll(async () => {
      this.lambdaOutput = await lambdaStep.getStepOutput(this.workflowExecution.executionArn, 'CNMToCMA');
    });

    it('outputs the granules object', () => {
      expect(this.lambdaOutput.payload).toEqual(expectedTranslatePayload);
    });
  });

  describe('the SyncGranule Lambda', () => {
    beforeAll(async () => {
      this.lambdaOutput = await lambdaStep.getStepOutput(this.workflowExecution.executionArn, 'SyncGranule');
    });

    it('outputs the granules object', () => {
      expect(this.lambdaOutput.payload).toEqual(expectedSyncGranulesPayload);
    });

    it('syncs data to s3 target location.', async () => {
      s3FileHead = await s3().headObject({
        Bucket: testConfig.buckets.private.name,
        Key: `${filePrefix}/${fileData.name}`
      }).promise();
      expect(new Date() - s3FileHead.LastModified < maxWaitTime).toBeTruthy();
    });
  });
});
