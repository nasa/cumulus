// npm packages
const _ = require('lodash');
const fs = require('fs');
const Handlebars = require('handlebars');
const md5 = require('md5');
const request = require('request');
const { Kinesis, StepFunctions, S3 } = require('aws-sdk');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

const {
  buildAndExecuteWorkflow,
  getWorkflowArn,
  LambdaStep,
  timeout,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');
const { randomString } = require('@cumulus/common/test-utils');

const { loadConfig } = require('../helpers/testUtils');
const testConfig = loadConfig();
console.log('testConfig', testConfig);
const lambdaStep = new LambdaStep();
const kinesis = new Kinesis({region: testConfig.awsRegion});
const sfn = new StepFunctions({region: testConfig.awsRegion});
const s3 = new S3({region: testConfig.awsRegion});
const streamName = testConfig.streamName;
const granuleId = 'L2_HR_PIXC_product_0001-of-4154';
const recordTemplate = Handlebars.compile(fs.readFileSync(`./data/records/${granuleId}.json`, 'utf8'));
let record = JSON.parse(recordTemplate(testConfig));

const recordIdentifier = randomString();
record.identifier = recordIdentifier;

console.log('record', record);

const recordFile = record['product']['files'][0];
const expectedTranslatePayload = {
  'granules': [
    {
      'granuleId': record['product']['name'],
      'files': [
        {
          'path': 'podaac-cumulus/test-data',
          'url_path': recordFile['uri'],
          'bucket': record['bucket'],
          'name': recordFile['name'],
          'size': recordFile['size']
        }
      ]
    }
  ]
};

const fileData = expectedTranslatePayload['granules'][0]['files'][0];
const publicBucket = testConfig.publicBucket;
const filePrefix = 'file-staging/podaac-test-swot/L2_HR_PIXC';

let fileDataWithFilename = {
  ...fileData,
  filename: `s3://${testConfig.privateBucket}/${filePrefix}/${recordFile['name']}`,
  bucket: testConfig.privateBucket,
  url_path: '',
  fileStagingDir: filePrefix
};

const expectedSyncGranulesPayload = {
  'granules': [
    {
      'granuleId': granuleId,
      'files': [ fileDataWithFilename ]
    }
  ]
};

const genericMetadataData = {
  'type': 0,
  'size': '0',
  'bucket': publicBucket,
  'name': `${filePrefix}/${granuleId}.h5.mp`,
  'filename': `s3://${publicBucket}/${filePrefix}/${granuleId}.h5.mp`
};

const expectedGenericMetaHandlerPayload = {
  'granules': [
    {
      'granuleId': granuleId,
      'files': [
        fileDataWithFilename,
        genericMetadataData
      ]
    }
  ]
};

const metadataXMLData = {
  'name': `${granuleId}.cmr.xml`,
  'bucket': publicBucket,
  'filename': `s3://${publicBucket}/${granuleId}.cmr.xml`,
  'url_path': '',
  'type': 0,
  'size': publicBucket.length + 1857 + ''
};

const expectedMetadataAggregatorPayload = {
  'granules': [
    {
      'granuleId': 'L2_HR_PIXC_product_0001-of-4154',
      'files': [
        fileDataWithFilename,
        genericMetadataData,
        metadataXMLData
      ]
    }
  ]
};

const expectedCMRStepPayload = {
  'process': 'MetadataAggregator',
  'granules': [
    {
      'granuleId': granuleId,
      'files': [
        fileDataWithFilename,
        {
          'bucket': publicBucket,
          'name': `${filePrefix}/${granuleId}.h5.mp`,
          'filename': `s3://${publicBucket}/${filePrefix}/${granuleId}.h5.mp`,
          'type': 0,
          'size': '0'
        },
        {
          'bucket': publicBucket,
          'name': `${granuleId}.cmr.xml`,
          'filename': `s3://${publicBucket}/${granuleId}.cmr.xml`,
          'url_path': '',
          'type': 0,
          'size': publicBucket.length + 1857 + ''
        }
      ],
      'published': true,
      'cmrLink': `https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=${testConfig.conceptId}`
    }
  ]
};

async function getLastExecution() {
  console.log('wait for workflowarn');
  const ingestKinesisStpFnArn = await getWorkflowArn(testConfig.stackName, testConfig.bucketName, 'IngestKinesis');
  console.log('ingestKinesisStpFnArn', ingestKinesisStpFnArn);
  return new Promise((resolve, reject) => {
    sfn.listExecutions({ stateMachineArn: ingestKinesisStpFnArn }, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(_.orderBy(data.executions, 'startDate', 'desc')[0]);
      }
    });
  });
};

describe('The Ingest Kinesis workflow', () => {
  const waitTimeInterval = 1000;
  const maxWaitTime = 4000;
  let timeWaited = 0;
  let putRecord;
  let lastExecution;
  let workflowExecution;
  let executionStatus;
  let s3FileHead;
  let theStream;

  beforeAll(async () => {
    // Create stream. REVIEW: Do we really need this? Developers may likely
    // setting up the stream themselves, once.
    console.log('Set up Stream', streamName);
    theStream = await new Promise((resolve, reject) => {
      kinesis.describeStream({StreamName: streamName}, (err, data) => {
        if (err && err.code === 'ResourceNotFoundException') {
          console.log('Create stream', streamName);
          kinesis.createStream({StreamName: streamName, ShardCount: 1}, (err, data) => {
            if (err) reject(err);
            resolve(data);
          });
        } else if (err) {
          reject(err);
        } else {
          resolve(data);
        };
      });
    });

    console.log('theStream', theStream);

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

    console.log('putRecord', putRecord);

    // Wait until a we discover an execution has started which matches our record identifier.
    // That will identify the execution we want to test.
    while (timeWaited < maxWaitTime && workflowExecution === undefined) {
      try {
        console.log('waited...', timeWaited);
        await timeout(waitTimeInterval);
        console.log('done waiting...', waitTimeInterval);
        timeWaited += waitTimeInterval;
        try{
	  console.log('wait for lastExecution');
          lastExecution = await getLastExecution();
	  console.log('lastExecution', lastExecution);
        } catch (e) {
          console.log(e);
        }
        // getLastExecution returns undefined if no previous execution exists
        if (lastExecution && lastExecution.executionArn) {
	  try{
	    console.log('sf2snsStart');
            taskOutput = await lambdaStep.getStepOutput(lastExecution.executionArn, 'sf2snsStart');
	    console.log('taskOutput', taskOutput);
            if (taskOutput.payload.identifier === recordIdentifier) {
              workflowExecution = lastExecution;
            }
	  } catch (e) {
	    console.log(e);
	  }
        }
      } catch (error) {
        console.log(error);
        throw new Error(error);
      }
    }

    console.log('workflowExecution', workflowExecution);

    // Wait for our execution to complete so we can test the outputs.
    if (workflowExecution === undefined) {
      throw new Error('Timeout waiting for new execution to start');
    } else {
      executionStatus = await waitForCompletedExecution(workflowExecution.executionArn);
    };

    s3FileHead = await new Promise((resolve, reject) => {
      s3.headObject({
        Bucket: testConfig.privateBucket,
        Key: `${filePrefix}/${fileData['name']}`
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
      expect(new Date() - s3FileHead.LastModified < maxWaitTime).toBeTruthy();
    });
  });

  describe('the GenericMetaHandler Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'GenericMetaHandler');
    });

    it('outputs the metadata product', () => {
      expect(lambdaOutput.payload).toEqual(expectedGenericMetaHandlerPayload);
    });
  });

  describe('the MetadataAggregator Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MetadataAggregator');
    });

    it('outputs the CMR XML', () => {
      expect(lambdaOutput.payload).toEqual(expectedMetadataAggregatorPayload);
    });
  });

  describe('the CMRStep Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
    });

    it('outputs published = true and a link to the granule in CMR', () => {
      expect(lambdaOutput.payload).toEqual(expectedCMRStepPayload);
    });

    it('data is in CMR', async () => {
      const cmrUrl = expectedCMRStepPayload.granules[0].cmrLink;
      await request(cmrUrl, { json: true }, (err, res, body) => {
        const updatedAt = Date.parse(res.body.feed.updated);
        // 2 minutes ago
        expect(new Date().getTime() - updatedAt < 120000).toBeTruthy();
      });
    });
  });
});
