'use strict';

const fs = require('fs-extra');
const hasha = require('hasha');

const { constructCollectionId } = require('@cumulus/message/Collections');
const { s3 } = require('@cumulus/aws-client/services');
const { getObjectReadStream, getObjectStreamContents } = require('@cumulus/aws-client/S3');
const {
  addCollections,
  api: apiTestUtils,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { getGranule, deleteGranule, waitForGranule } = require('@cumulus/api-client/granules');
const { deleteExecution } = require('@cumulus/api-client/executions');
const {
  deleteProvider, createProvider,
} = require('@cumulus/api-client/providers');

const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');
const { buildAndStartWorkflow } = require('../../helpers/workflowUtils');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
} = require('../../helpers/testUtils');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');

const workflowName = 'TestPythonProcessing';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
];

describe('The TestPythonProcessing workflow', () => {
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006_no_cmr';
  const collectionDupeHandling = 'error';

  const activityStep = new ActivityStep();

  let beforeAllError;
  let collection;
  let config;
  let expectedS3TagSet;
  let granuleResult;
  let inputPayload;
  let pdrFilename;
  let provider;
  let providerData;
  let testDataFolder;
  let workflowExecutionArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      const testId = createTimestampedTestId(config.stackName, 'PythonProcessingIngest');
      const testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      provider = { id: `s3_provider${testSuffix}` };
      process.env.system_bucket = config.bucket;

      const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/s3_provider.json`, 'utf8'));
      providerData = {
        ...providerJson,
        id: provider.id,
        host: config.bucket,
      };
      // populate collections, providers and test data
      await Promise.all([
        uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId, collectionDupeHandling),
        createProvider({ prefix: config.stackName, provider: providerData }),
      ]);

      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      // update test data filepaths
      inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
      pdrFilename = inputPayload.pdr.name;
      const granuleId = inputPayload.granules[0].granuleId;
      expectedS3TagSet = [{ Key: 'granuleId', Value: granuleId }];
      await Promise.all(inputPayload.granules[0].files.map((fileToTag) =>
        s3().putObjectTagging({ Bucket: config.bucket, Key: `${fileToTag.path}/${fileToTag.name}`, Tagging: { TagSet: expectedS3TagSet } })));

      console.log('Start SuccessExecution');
      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload,
        {
          distribution_endpoint: process.env.DISTRIBUTION_ENDPOINT,
        }
      );
    } catch (error) {
      beforeAllError = error;
    }
  });

  beforeEach(() => {
    if (beforeAllError) fail(beforeAllError);
  });

  afterAll(async () => {
    // clean up stack state added by test
    await deleteGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId,
    });
    await apiTestUtils.deletePdr({
      prefix: config.stackName,
      pdr: pdrFilename,
    });
    await deleteProvider({ prefix: config.stackName, providerId: provider.id });
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecutionArn });

    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      deleteCollection({
        prefix: config.stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      }),
    ]);
  });

  it('makes the granule available through the Cumulus API', async () => {
    await waitForGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId,
      collectionId: constructCollectionId(collection.name, collection.version),
      status: 'completed',
    });
    granuleResult = await getGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId,
      collectionId: constructCollectionId(collection.name, collection.version),
    });
    expect(granuleResult.granuleId).toEqual(inputPayload.granules[0].granuleId);
    expect(granuleResult.status).toEqual('completed');
  });

  it('has a checksum file that matches the ingested granule file', async () => {
    const md5File = granuleResult.files.find((f) => f.key.match('.hdf.md5'));
    const dataFile = granuleResult.files.find((f) => f.key.match('.hdf$'));
    const dataStream = await getObjectReadStream({
      bucket: dataFile.bucket,
      key: dataFile.key,
      s3: s3(),
    });
    const dataHash = await hasha.fromStream(dataStream, { algorithm: 'md5', encoding: 'hex' });
    const md5FileContent = await s3().getObject({ Bucket: md5File.bucket, Key: md5File.key });

    expect(dataHash).toEqual(await getObjectStreamContents(md5FileContent.Body));
  });

  it('completes execution with success status', async () => {
    const workflowExecutionStatus = await waitForCompletedExecution(workflowExecutionArn);
    expect(workflowExecutionStatus).toEqual('SUCCEEDED');
  });

  describe('the ProcessingStep activity', () => {
    let activityOutput;
    let processingFiles;
    beforeAll(async () => {
      try {
        activityOutput = await activityStep.getStepOutput(workflowExecutionArn, 'EcsTaskPythonIngestProcessingProcess');
        if (activityOutput === null) {
          beforeAllError = new Error(`Failed to get the Processing activity's output for ${workflowExecutionArn}`);
          return;
        }
        processingFiles = activityOutput.payload;
      } catch (error) {
        beforeAllError = error;
      }
    });

    beforeEach(() => {
      if (beforeAllError) fail(beforeAllError);
    });
    it('has added a checksum metadata file to the granule', () => {
      expect(processingFiles.find((a) => a.includes('.hdf.md5'))).toBeTruthy();
    });
  });
});
