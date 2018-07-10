// npm packages
const _ = require('lodash');
const fs = require('fs');
const Handlebars = require('handlebars');
const { Kinesis, StepFunctions, S3 } = require('aws-sdk');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

const {
  getWorkflowArn,
  LambdaStep,
  timeout,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');
const { randomString } = require('@cumulus/common/test-utils');

const { loadConfig } = require('../helpers/testUtils');
const testConfig = loadConfig();
const lambdaStep = new LambdaStep();
const kinesis = new Kinesis({ region: testConfig.awsRegion });
const sfn = new StepFunctions({ region: testConfig.awsRegion });
const s3 = new S3({ region: testConfig.awsRegion });
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


async function getLastExecution() {
  const kinesisTriggerTestStpFnArn = await getWorkflowArn(testConfig.stackName, testConfig.bucketName, 'KinesisTriggerTest');
  return new Promise((resolve, reject) => {
    sfn.listExecutions({ stateMachineArn: kinesisTriggerTestStpFnArn }, (err, data) => {
      if (err) {
        reject(err);
      }
      else {
        resolve(_.orderBy(data.executions, 'startDate', 'desc')[0]);
      }
    });
  });
}

describe('The Ingest Kinesis workflow', () => {
  const waitTimeInterval = 1000;
  const maxWaitTime = 240000;
  let timeWaited = 0;
  let putRecord;
  let lastExecution;
  let workflowExecution;
  let executionStatus;
  let s3FileHead;

  beforeAll(async () => {
    // Create stream. REVIEW: Do we really need this? Developers may likely
    // setting up the stream themselves, once.
    await new Promise((resolve, reject) => {
      kinesis.describeStream({ StreamName: streamName }, (err, data) => {
        if (err && err.code === 'ResourceNotFoundException') {
          kinesis.createStream({ StreamName: streamName, ShardCount: 1 }, (err, data) => {
            if (err) reject(err);
            resolve(data);
          });
        }
        else if (err) {
          reject(err);
        }
        else {
          resolve(data);
        }
      });
    });


    putRecord = await new Promise((resolve, reject) => {
      kinesis.putRecord({
        Data: JSON.stringify(record),
        PartitionKey: '1',
        StreamName: streamName
      }, (err, data) => {
        if (err) reject(err);
        resolve(data);
      });
    });


    // Wait until a we discover an execution has started which matches our record identifier.
    // That will identify the execution we want to test.
    while (timeWaited < maxWaitTime && workflowExecution === undefined) {
      try {
        await timeout(waitTimeInterval);
        timeWaited += waitTimeInterval;
        try {
          lastExecution = await getLastExecution();
        }
        catch (error) {
          console.log(error);
          throw new Error(error);
        }
        // getLastExecution returns undefined if no previous execution exists
        if (lastExecution && lastExecution.executionArn) {
          try {
            const taskOutput = await lambdaStep.getStepOutput(lastExecution.executionArn, 'sf2snsStart');
            if (taskOutput.payload.identifier === recordIdentifier) {
              workflowExecution = lastExecution;
            }
          }
          catch (error) {
            console.log(error);
            throw new Error(error);
          }
        }
      }
      catch (error) {
        console.log(error);
        throw new Error(error);
      }
    }

    // Wait for our execution to complete so we can test the outputs.
    if (workflowExecution === undefined) {
      throw new Error('Timeout waiting for new execution to start');
    }
    else {
      executionStatus = await waitForCompletedExecution(workflowExecution.executionArn);
    }

    s3FileHead = await new Promise((resolve, reject) => {
      s3.headObject({
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
