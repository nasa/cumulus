'use strict';

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');
const isMatch = require('lodash/isMatch');
const replace = require('lodash/replace');
const { getJsonS3Object, parseS3Uri } = require('@cumulus/aws-client/S3');
const { getWorkflowFileKey } = require('@cumulus/common/workflows');
const { Execution } = require('@cumulus/api/models');
const fs = require('fs');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 9 * 60 * 1000;

const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const {
  getEventSourceMapping,
  addRules,
  waitForCompletedExecution,
  addProviders,
  cleanupProviders,
  addCollections,
  cleanupCollections,
  readJsonFilesFromDir,
  deleteRules,
  setProcessEnvironment,
} = require('@cumulus/integration-tests');
const { getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const granulesApi = require('@cumulus/api-client/granules');
const { randomString } = require('@cumulus/common/test-utils');

const { waitForModelStatus } = require('../../helpers/apiUtils');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
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
  waitForTestSfForRecord,
} = require('../../helpers/kinesisHelpers');

const testWorkflow = 'KinesisTriggerTest';

// When kinesis-type rules exist, the Cumulus lambda messageConsumer is
// configured to trigger workflows when new records arrive on a Kinesis
// stream. When a record appears on the stream, the messageConsumer lambda
// triggers workflows associated with the kinesis-type rules.
describe('The Cloud Notification Mechanism Kinesis workflow', () => {
  const collectionsDir = './data/collections/L2_HR_PIXC-000/';
  const maxWaitForExecutionSecs = 60 * 5;
  const maxWaitForSFExistSecs = 60 * 4;
  const providersDir = './data/providers/PODAAC_SWOT/';

  let cnmResponseStreamName;
  let executionModel;
  let executionNamePrefix;
  let executionStatus;
  let expectedSyncGranulesPayload;
  let expectedTranslatePayload;
  let fileData;
  let filePrefix;
  let granuleId;
  let lambdaStep;
  let logEventSourceMapping;
  let record;
  let recordFile;
  let recordIdentifier;
  let responseStreamShardIterator;
  let ruleDirectory;
  let ruleOverride;
  let ruleSuffix;
  let streamName;
  let testConfig;
  let testDataFolder;
  let testSuffix;
  let workflowArn;
  let workflowExecution;

  async function cleanUp() {
    setProcessEnvironment(testConfig.stackName, testConfig.bucket);
    // delete rule
    console.log(`\nDeleting ${ruleOverride.name}`);
    const rules = await readJsonFilesFromDir(ruleDirectory);
    // clean up stack state added by test
    console.log(`\nCleaning up stack & deleting test streams '${streamName}' and '${cnmResponseStreamName}'`);
    await deleteRules(testConfig.stackName, testConfig.bucket, rules, ruleSuffix);
    await Promise.all([
      deleteFolder(testConfig.bucket, testDataFolder),
      cleanupCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      cleanupProviders(testConfig.stackName, testConfig.bucket, providersDir, testSuffix),
      deleteTestStream(streamName),
      deleteTestStream(cnmResponseStreamName),
    ]);
  }

  beforeAll(async () => {
    testConfig = await loadConfig();
    const testId = createTimestampedTestId(testConfig.stackName, 'KinesisTestTrigger');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);
    ruleSuffix = replace(testSuffix, /-/g, '_');

    const workflowDefinition = await getJsonS3Object(
      testConfig.bucket,
      getWorkflowFileKey(testConfig.stackName, testWorkflow)
    );
    workflowArn = workflowDefinition.arn;

    record = JSON.parse(fs.readFileSync(`${__dirname}/data/records/L2_HR_PIXC_product_0001-of-4154.json`));

    record.product.files[0].uri = replace(
      record.product.files[0].uri,
      /cumulus-test-data\/pdrs/g,
      testDataFolder
    );
    record.provider += testSuffix;
    record.collection += testSuffix;
    record.product.name += testSuffix;

    granuleId = record.product.name;
    recordIdentifier = randomString();
    record.identifier = recordIdentifier;

    lambdaStep = new LambdaStep();

    recordFile = record.product.files[0];
    expectedTranslatePayload = {
      granules: [
        {
          granuleId: record.product.name,
          version: record.product.dataVersion,
          dataType: record.collection,
          files: [
            {
              name: recordFile.name,
              type: recordFile.type,
              bucket: parseS3Uri(recordFile.uri).Bucket,
              path: testDataFolder,
              url_path: recordFile.uri,
              size: recordFile.size,
              checksumType: recordFile.checksumType,
              checksum: recordFile.checksum,
            },
          ],
        },
      ],
    };

    fileData = expectedTranslatePayload.granules[0].files[0];
    filePrefix = `file-staging/${testConfig.stackName}/${record.collection}___000`;

    const fileDataWithFilename = {
      ...fileData,
      filename: `s3://${testConfig.buckets.private.name}/${filePrefix}/${recordFile.name}`,
      bucket: testConfig.buckets.private.name,
      fileStagingDir: filePrefix,
      size: fileData.size,
    };

    expectedSyncGranulesPayload = {
      granules: [
        {
          granuleId: granuleId,
          dataType: record.collection,
          version: '000',
          files: [fileDataWithFilename],
        },
      ],
    };

    executionNamePrefix = randomString(3);

    ruleDirectory = './spec/parallel/kinesisTests/data/rules';
    ruleOverride = {
      name: `L2_HR_PIXC_kinesisRule${ruleSuffix}`,
      collection: {
        name: record.collection,
        version: '000',
      },
      provider: record.provider,
      executionNamePrefix,
    };

    const s3data = ['@cumulus/test-data/granules/L2_HR_PIXC_product_0001-of-4154.h5'];

    process.env.ExecutionsTable = `${testConfig.stackName}-ExecutionsTable`;

    streamName = `${testId}-KinesisTestTriggerStream`;
    cnmResponseStreamName = `${testId}-KinesisTestTriggerCnmResponseStream`;
    testConfig.streamName = streamName;
    testConfig.cnmResponseStream = cnmResponseStreamName;

    executionModel = new Execution();

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(testConfig.bucket, s3data, testDataFolder),
      addCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      addProviders(testConfig.stackName, testConfig.bucket, providersDir, testConfig.bucket, testSuffix),
    ]);
    // create streams
    await tryCatchExit(cleanUp, async () => {
      await Promise.all([
        createOrUseTestStream(streamName),
        createOrUseTestStream(cnmResponseStreamName),
      ]);
      console.log(`\nWaiting for active streams: '${streamName}' and '${cnmResponseStreamName}'.`);
      await Promise.all([
        waitForActiveStream(streamName),
        waitForActiveStream(cnmResponseStreamName),
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
    expect(mapping.FunctionArn.endsWith(`${testConfig.stackName}-KinesisInboundEventLogger`)).toBeTrue();
    expect(mapping.EventSourceArn.endsWith(streamName)).toBeTrue();
  });

  it('Prepares a kinesis stream for integration tests.', async () => {
    expect(await getStreamStatus(streamName)).toBe('ACTIVE');
  });

  describe('Workflow executes successfully', () => {
    beforeAll(async () => {
      await tryCatchExit(cleanUp, async () => {
        console.log(`Dropping record onto  ${streamName}, recordIdentifier: ${recordIdentifier}`);
        await putRecordOnStream(streamName, record);

        console.log('Waiting for step function to start...');
        workflowExecution = await waitForTestSfForRecord(recordIdentifier, workflowArn, maxWaitForSFExistSecs);

        console.log(`Waiting for completed execution of ${workflowExecution.executionArn}`);
        executionStatus = await waitForCompletedExecution(workflowExecution.executionArn, maxWaitForExecutionSecs);
      });
    });

    afterAll(async () => {
      await executionModel.delete({ arn: workflowExecution.executionArn });
      await granulesApi.removeFromCMR({ prefix: testConfig.stackName, granuleId });
      await granulesApi.deleteGranule({ prefix: testConfig.stackName, granuleId });
    });

    it('executes successfully', () => {
      expect(executionStatus).toEqual('SUCCEEDED');
    });

    it('creates an execution with the correct prefix', () => {
      const executionName = workflowExecution.executionArn.split(':').reverse()[0];
      expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
    });

    describe('the TranslateMessage Lambda', () => {
      let lambdaOutput;
      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'CNMToCMA');
      });

      it('outputs the expectedTranslatePayload object', () => {
        expect(lambdaOutput.payload).toEqual(expectedTranslatePayload);
      });

      it('maps the CNM object correctly', () => {
        expect(lambdaOutput.meta.cnm.receivedTime).not.toBeNull();
        delete lambdaOutput.meta.cnm.receivedTime;

        expect(lambdaOutput.meta.cnm).toEqual({
          product: record.product,
          identifier: recordIdentifier,
          provider: record.provider,
          collection: record.collection,
          submissionTime: record.submissionTime,
          version: record.version,
        });
      });
    });

    describe('the execution record', () => {
      let startStep;
      let endStep;
      beforeAll(async () => {
        startStep = await lambdaStep.getStepInput(workflowExecution.executionArn, 'CNMToCMA');
        endStep = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'CnmResponse');
      });

      it('records both the original and the final payload', async () => {
        const executionRecord = await waitForModelStatus(
          executionModel,
          { arn: workflowExecution.executionArn },
          'completed'
        );
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
        const updatedExpectedPayload = {
          ...expectedSyncGranulesPayload,
          granules: [
            {
              ...expectedSyncGranulesPayload.granules[0],
              sync_granule_duration: lambdaOutput.payload.granules[0].sync_granule_duration,
            },
          ],
        };
        updatedExpectedPayload.granules[0].files[0].url_path = lambdaOutput.payload.granules[0].files[0].url_path;
        expect(lambdaOutput.payload).toEqual(updatedExpectedPayload);
      });
    });

    describe('the CnmResponse Lambda', () => {
      let lambdaOutput;
      let granule;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'CnmResponse');
        granule = await getGranuleWithStatus({
          prefix: testConfig.stackName,
          granuleId,
          status: 'completed',
        });
      });

      it('outputs the expected object', () => {
        const actualPayload = lambdaOutput.payload;
        expect(actualPayload.granules.length).toBe(1);
        expect(actualPayload.granules[0].granuleId).toBe(granuleId);
      });

      it('writes a message to the response stream', async () => {
        console.log(`Fetching shard iterator for response stream  '${cnmResponseStreamName}'`);
        responseStreamShardIterator = await getShardIterator(cnmResponseStreamName);
        const newResponseStreamRecords = await getRecords(responseStreamShardIterator);
        const parsedRecords = newResponseStreamRecords.map((r) => JSON.parse(r.Data.toString()));
        const responseRecord = parsedRecords.find((r) => r.identifier === recordIdentifier);
        expect(responseRecord.identifier).toEqual(recordIdentifier);
        expect(responseRecord.response.status).toEqual('SUCCESS');
        expect(responseRecord).toEqual(lambdaOutput.meta.cnmResponse);
      });

      it('puts cnmResponse to cumulus message for granule record', async () => {
        const expectedCnmResponse = {
          version: record.version,
          submissionTime: record.submissionTime,
          collection: record.collection,
          provider: record.provider,
          identifier: record.identifier,
          product: {
            dataVersion: record.product.dataVersion,
            name: record.product.name,
          },
          response: {
            status: 'SUCCESS',
          },
        };

        const cnmResponse = get(lambdaOutput, 'meta.granule.queryFields.cnm');
        expect(isMatch(cnmResponse, expectedCnmResponse)).toBe(true);
        expect(cnmResponse.product.files.length).toBe(2);
        expect(get(granule, 'queryFields.cnm')).toEqual(cnmResponse);
      });
    });
  });

  describe('Workflow fails because SyncGranule fails', () => {
    let failingWorkflowExecution;
    let badRecord;

    beforeAll(async () => {
      badRecord = cloneDeep(record);
      badRecord.identifier = randomString();
      // bad record has a file which doesn't exist
      badRecord.product.files[0].uri = 's3://not-exist-bucket/somepath/somekey';

      await tryCatchExit(cleanUp, async () => {
        console.log(`Dropping bad record onto ${streamName}, recordIdentifier: ${badRecord.identifier}.`);
        await putRecordOnStream(streamName, badRecord);

        console.log('Waiting for step function to start...');
        failingWorkflowExecution = await waitForTestSfForRecord(badRecord.identifier, workflowArn, maxWaitForSFExistSecs);

        console.log(`Waiting for completed execution of ${failingWorkflowExecution.executionArn}.`);
        executionStatus = await waitForCompletedExecution(failingWorkflowExecution.executionArn, maxWaitForExecutionSecs);
      });
    });

    afterAll(async () => {
      await executionModel.delete({ arn: failingWorkflowExecution.executionArn });
      await granulesApi.deleteGranule({ prefix: testConfig.stackName, granuleId });
    });

    it('executes but fails', () => {
      expect(executionStatus).toEqual('FAILED');
    });

    it('outputs the error', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(failingWorkflowExecution.executionArn, 'SyncGranule', 'failure');
      expect(lambdaOutput.error).toEqual('FileNotFound');
      expect(lambdaOutput.cause).toMatch(/.+Source file not found.+/);
    });

    describe('the CnmResponse Lambda', () => {
      let lambdaOutput;
      let granule;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(failingWorkflowExecution.executionArn, 'CnmResponse');
        granule = await getGranuleWithStatus({
          prefix: testConfig.stackName,
          granuleId,
          status: 'failed',
        });
      });

      it('sends the error to the CnmResponse task', async () => {
        const CnmResponseInput = await lambdaStep.getStepInput(failingWorkflowExecution.executionArn, 'CnmResponse');
        expect(CnmResponseInput.exception.Error).toEqual('FileNotFound');
        expect(JSON.parse(CnmResponseInput.exception.Cause).errorMessage).toMatch(/Source file not found.+/);
      });

      it('writes a failure message to the response stream', async () => {
        console.log(`Fetching shard iterator for response stream  '${cnmResponseStreamName}'.`);
        responseStreamShardIterator = await getShardIterator(cnmResponseStreamName);
        const newResponseStreamRecords = await getRecords(responseStreamShardIterator);
        if (newResponseStreamRecords.length > 0) {
          const parsedRecords = newResponseStreamRecords.map((r) => JSON.parse(r.Data.toString()));
          const responseRecord = parsedRecords.pop();
          expect(responseRecord.response.status).toEqual('FAILURE');
          expect(responseRecord.identifier).toBe(badRecord.identifier);
        } else {
          fail(`unexpected error occurred and no messages found in ${cnmResponseStreamName}. Did the "ouputs the record" above fail?`);
        }
      });

      it('puts cnm message to cumulus message for granule record', async () => {
        const cnm = get(lambdaOutput, 'meta.granule.queryFields.cnm');
        expect(isMatch(cnm, badRecord)).toBe(true);
        expect(get(granule, 'queryFields.cnm')).toEqual(cnm);
      });
    });
  });
});
