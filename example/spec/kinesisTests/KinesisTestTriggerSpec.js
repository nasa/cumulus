// npm packages
const fs = require('fs');
const Handlebars = require('handlebars');
const { s3 } = require('@cumulus/common/aws');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

const {
  LambdaStep,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');
const { randomString } = require('@cumulus/common/test-utils');

const { loadConfig } = require('../helpers/testUtils');
const { createOrUseTestStream, putRecordOnStream, waitForTestSfStarted } = require('../helpers/kinesisHelpers');
const testConfig = loadConfig();
const lambdaStep = new LambdaStep();

const streamName = testConfig.streamName;
const granuleId = 'L2_HR_PIXC_product_0001-of-4154';
const recordTemplate = Handlebars.compile(fs.readFileSync(`./data/records/${granuleId}.json`, 'utf8'));
const record = JSON.parse(recordTemplate(testConfig));
const recordIdentifier = randomString();
record.identifier = recordIdentifier;

const recordFile = record.product.files[0];
const expectedTranslatePayload = {
  granules: [
    {
      granuleId: record.product.name,
      files: [
        {
          path: 'unit/test-data',
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
const filePrefix = 'file-staging/mhs-cumulus/L2_HR_PIXC';

const fileDataWithFilename = {
  ...fileData,
  filename: `s3://${testConfig.privateBucket}/${filePrefix}/${recordFile.name}`,
  bucket: testConfig.privateBucket,
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


// When Cumulus is configured to trigger a CNM workflow from a Kinesis stream and a message appears on the stream, Cumulus triggers the workflow

describe('The Cloud Notification Mechanism Kinesis workflow', () => {
  const maxWaitTime = 240000;
  let workflowExecution;
  let executionStatus;
  let s3FileHead;

  afterAll(async () => {
    await s3().deleteObject({
      Bucket: testConfig.privateBucket,
      Key: `${filePrefix}/${fileData.name}`
    }).promise();
  });

  beforeAll(async () => {
    try {
      await createOrUseTestStream(streamName);
      console.log('createOrUseTestStream');
      await putRecordOnStream(streamName, record);
      console.log('putRecordOnStream');
      workflowExecution = await waitForTestSfStarted(recordIdentifier, maxWaitTime);
      console.log('workflow running', workflowExecution);
    }
    catch (e) {
      console.log(e);
      throw e;
    }

    // Wait for our execution to complete so we can test the outputs.
    if (workflowExecution === undefined) {
      throw new Error('Timeout waiting for new execution to start');
    }
    else {
      executionStatus = await waitForCompletedExecution(workflowExecution.executionArn);
    }

    s3FileHead = await new Promise((resolve, reject) => {
      s3().headObject({
        Bucket: testConfig.privateBucket,
        Key: `${filePrefix}/${fileData.name}`
      }, (err, data) => {
        if (err) reject(err);
        resolve(data);
      });
    });
  });

  it('executes successfully', () => {
    expect(executionStatus).toEqual('SUCCEEDED');
  });

  describe('the TranslateMessage Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      // This is a bit confusing - currently the workflow definition calls this step
      // 'TranslateMessage', but the lambda is 'CNMToCMA' which is what
      // integration tests package looks for when looking up the step execution.
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'CNMToCMA');
    });

    it('outputs the granules object', () => {
      expect(lambdaOutput.payload).toEqual(expectedTranslatePayload);
    });
  });

  describe('the SyncGranule Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
    });

    it('outputs the granules object', () => {
      expect(lambdaOutput.payload).toEqual(expectedSyncGranulesPayload);
    });

    it('syncs data to s3', () => {
      // Seems like a race condition?  Should create a date in the first 'The
      // Ingest Kinesis workflow'::beforeAll?  Maybe I just don't understand
      // what this is testing.
      expect(new Date() - s3FileHead.LastModified < maxWaitTime).toBeTruthy();
    });
  });
});
