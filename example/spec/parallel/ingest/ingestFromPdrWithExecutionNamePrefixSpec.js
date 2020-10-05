'use strict';

/**
 * End to end ingest from discovering a PDR
 *
 * Kick off discover and queue pdrs which:
 * Discovers 1 PDR
 * Queues that PDR
 * Kicks off the ParsePDR workflow
 *
 * Parse PDR workflow:
 * parses pdr
 * queues a granule
 * pdr status check
 * This will kick off the ingest workflow
 *
 * Ingest worklow:
 * runs sync granule - saves file to file staging location
 * performs the fake processing step - generates CMR metadata
 * Moves the file to the final location
 * Does not post to CMR (that is in a separate test)
 */

const { randomString } = require('@cumulus/common/test-utils');
const { deleteS3Object } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');

const {
  addCollections,
  addProviders,
  api: apiTestUtils,
  buildAndExecuteWorkflow,
  cleanupProviders,
  cleanupCollections,
  waitForStartedExecution,
} = require('@cumulus/integration-tests');

const {
  createTestDataPath,
  createTestSuffix,
  createTimestampedTestId,
  deleteFolder,
  loadConfig,
  uploadTestDataToBucket,
  updateAndUploadTestDataToBucket,
} = require('../../helpers/testUtils');

const lambdaStep = new LambdaStep();
const workflowName = 'DiscoverAndQueuePdrsExecutionPrefix';
const origPdrFilename = 'MOD09GQ_1granule_v3.PDR';

const s3data = [
  '@cumulus/test-data/pdrs/MOD09GQ_1granule_v3.PDR',
];

const unmodifiedS3Data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
];

describe('The DiscoverAndQueuePdrsExecutionPrefix workflow', () => {
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  let beforeAllFailed;
  let config;
  let pdrFilename;
  let provider;
  let testDataFolder;
  let testSuffix;
  let workflowExecution;
  let addedCollection;
  let executionNamePrefix;
  let queuePdrsOutput;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      process.env.PdrsTable = `${config.stackName}-PdrsTable`;

      const testId = createTimestampedTestId(config.stackName, 'IngestFromPdr');
      testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      pdrFilename = `${testSuffix.slice(1)}_${origPdrFilename}`;

      provider = { id: `s3_provider${testSuffix}` };

      // populate collections, providers and test data
      const populatePromises = await Promise.all([
        updateAndUploadTestDataToBucket(
          config.bucket,
          s3data,
          testDataFolder,
          [
            { old: 'cumulus-test-data/pdrs', new: testDataFolder },
            { old: 'DATA_TYPE = MOD09GQ;', new: `DATA_TYPE = MOD09GQ${testSuffix};` },
          ]
        ),
        uploadTestDataToBucket(
          config.bucket,
          unmodifiedS3Data,
          testDataFolder
        ),
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
        addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
      ]);

      addedCollection = populatePromises[2][0];

      // Rename the PDR to avoid race conditions
      await s3().copyObject({
        Bucket: config.bucket,
        CopySource: `${config.bucket}/${testDataFolder}/${origPdrFilename}`,
        Key: `${testDataFolder}/${pdrFilename}`,
      }).promise();

      await deleteS3Object(config.bucket, `${testDataFolder}/${origPdrFilename}`);

      executionNamePrefix = randomString(3);

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        { name: addedCollection.name, version: addedCollection.version },
        provider,
        undefined,
        {
          provider_path: testDataFolder,
          executionNamePrefix,
        }
      );

      queuePdrsOutput = await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'QueuePdrs'
      );
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      apiTestUtils.deletePdr({
        prefix: config.stackName,
        pdr: pdrFilename,
      }),
    ]);
  });

  it('executes successfully', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    }
  });

  it('properly sets the name of the queued execution', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const executionArn = queuePdrsOutput.payload.running[0];

      const executionName = executionArn.split(':').reverse()[0];

      expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
    }
  });

  it('results in an IngestGranule workflow execution', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const executionArn = queuePdrsOutput.payload.running[0];
      await expectAsync(waitForStartedExecution(executionArn)).toBeResolved();
    }
  });
});
