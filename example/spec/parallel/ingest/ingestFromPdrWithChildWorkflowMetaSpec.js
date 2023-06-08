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

const cryptoRandomString = require('crypto-random-string');
const { deleteS3Object } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { deleteGranule } = require('@cumulus/api-client/granules');

const {
  addCollections,
  addProviders,
  cleanupProviders,
  cleanupCollections,
  getExecutionInputObject,
  waitForStartedExecution,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');
const { encodedConstructCollectionId } = require('@cumulus/message/Collections');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const {
  createTestDataPath,
  createTestSuffix,
  createTimestampedTestId,
  deleteFolder,
  loadConfig,
  uploadTestDataToBucket,
  updateAndUploadTestDataToBucket,
} = require('../../helpers/testUtils');

const {
  waitAndDeletePdr,
} = require('../../helpers/pdrUtils');

const lambdaStep = new LambdaStep();
const workflowName = 'DiscoverAndQueuePdrsChildWorkflowMeta';
const origPdrFilename = 'MOD09GQ_1granule_v3.PDR';
const granuleDateString = '2016360104606';
const granuleIdReplacement = cryptoRandomString({ length: 13, type: 'numeric' });
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606'.replace(granuleDateString, granuleIdReplacement);

const s3data = [
  '@cumulus/test-data/pdrs/MOD09GQ_1granule_v3.PDR',
];

const unmodifiedS3Data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
];

describe('The DiscoverAndQueuePdrsChildWorkflowMeta workflow', () => {
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  let addedCollections;
  let beforeAllFailed;
  let config;
  let executionNamePrefix;
  let discoverPdrsExecutionArn;
  let ingestGranuleExecutionArn;
  let parsePdrExecutionArn;
  let pdrFilename;
  let provider;
  let queuePdrsOutput;
  let testDataFolder;
  let testSuffix;
  let workflowExecution;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      const testId = createTimestampedTestId(config.stackName, 'IngestFromPdrWithChildWorkflowMeta');
      testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      pdrFilename = `${testSuffix.slice(1)}_${origPdrFilename}`;

      provider = { id: `s3_provider${testSuffix}` };

      // populate collections, providers and test data
      [addedCollections] = await Promise.all([
        addCollections(
          config.stackName,
          config.bucket,
          collectionsDir,
          testSuffix,
          testId
        ),
        updateAndUploadTestDataToBucket(config.bucket, s3data, testDataFolder, [
          { old: 'cumulus-test-data/pdrs', new: testDataFolder },
          {
            old: 'DATA_TYPE = MOD09GQ;',
            new: `DATA_TYPE = MOD09GQ${testSuffix};`,
          },
          { old: granuleDateString, new: granuleIdReplacement },
        ]),
        uploadTestDataToBucket(config.bucket, unmodifiedS3Data, testDataFolder),
        addProviders(
          config.stackName,
          config.bucket,
          providersDir,
          config.bucket,
          testSuffix
        ),
      ]);

      // Rename the PDR to avoid race conditions
      await s3().copyObject({
        Bucket: config.bucket,
        CopySource: `${config.bucket}/${testDataFolder}/${origPdrFilename}`,
        Key: `${testDataFolder}/${pdrFilename}`,
      });

      await deleteS3Object(config.bucket, `${testDataFolder}/${origPdrFilename}`);

      executionNamePrefix = cryptoRandomString({
        length: 3,
        type: 'alphanumeric',
      });

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        { name: addedCollections[0].name, version: addedCollections[0].version },
        provider,
        undefined,
        {
          provider_path: testDataFolder,
          executionNamePrefix,
        }
      );

      discoverPdrsExecutionArn = workflowExecution.executionArn;

      queuePdrsOutput = await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'QueuePdrs'
      );
      parsePdrExecutionArn = queuePdrsOutput.payload.running[0];

      await waitForCompletedExecution(parsePdrExecutionArn);
      const queueGranulesOutput = await lambdaStep.getStepOutput(
        parsePdrExecutionArn,
        'QueueGranules'
      );
      ingestGranuleExecutionArn = queueGranulesOutput.payload.running[0];
      console.log('ingest granule execution ARN:', ingestGranuleExecutionArn);
    } catch (error) {
      beforeAllFailed = error;
      throw error;
    }
  });

  afterAll(async () => {
    // clean up stack state added by test
    await deleteGranule({
      prefix: config.stackName,
      granuleId: testDataGranuleId,
      collectionId: encodedConstructCollectionId(addedCollections[0].name, addedCollections[0].version),
    });
    await waitAndDeletePdr(
      config.stackName,
      pdrFilename,
      'completed'
    );

    // The order of execution deletes matters. Children must be deleted before parents.
    await deleteExecution({ prefix: config.stackName, executionArn: ingestGranuleExecutionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: parsePdrExecutionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: discoverPdrsExecutionArn });

    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
    ]);
  });

  it('executes successfully', () => {
    if (beforeAllFailed) fail(beforeAllFailed);
    else {
      expect(workflowExecution.status).toEqual('completed');
    }
  });

  it('results in an IngestGranule workflow execution', async () => {
    if (beforeAllFailed) fail(beforeAllFailed);
    else {
      await expectAsync(waitForStartedExecution(ingestGranuleExecutionArn)).toBeResolved();
    }
  });

  it('passes through childWorkflowMeta to the IngestGranule execution', async () => {
    if (beforeAllFailed) fail(beforeAllFailed);
    const executionInput = await getExecutionInputObject(parsePdrExecutionArn);
    expect(executionInput.meta.staticValue).toEqual('aStaticValue');
    expect(executionInput.meta.interpolatedValueStackName).toEqual(queuePdrsOutput.meta.stack);
  });
});
