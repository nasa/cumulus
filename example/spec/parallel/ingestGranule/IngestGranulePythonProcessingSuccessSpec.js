'use strict';

const fs = require('fs-extra');
const hasha = require('hasha');
const pMap = require('p-map');
const pRetry = require('p-retry');

const {
  Execution,
  Pdr,
} = require('@cumulus/api/models');
const GranuleFilesCache = require('@cumulus/api/lib/GranuleFilesCache');
const { parseS3Uri } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const {
  addCollections,
  buildAndStartWorkflow,
  getExecutionOutput,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { getGranule, removePublishedGranule, waitForGranule } = require('@cumulus/api-client/granules');
const {
  deleteProvider, createProvider,
} = require('@cumulus/api-client/providers');

const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');

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
  let executionModel;
  let expectedS3TagSet;
  let granuleResult;
  let inputPayload;
  let pdrModel;
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
      process.env.GranulesTable = `${config.stackName}-GranulesTable`;
      process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
      executionModel = new Execution();
      process.env.system_bucket = config.bucket;
      process.env.ProvidersTable = `${config.stackName}-ProvidersTable`;
      process.env.PdrsTable = `${config.stackName}-PdrsTable`;

      pdrModel = new Pdr();

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
      const granuleId = inputPayload.granules[0].granuleId;
      expectedS3TagSet = [{ Key: 'granuleId', Value: granuleId }];
      await Promise.all(inputPayload.granules[0].files.map((fileToTag) =>
        s3().putObjectTagging({ Bucket: config.bucket, Key: `${fileToTag.path}/${fileToTag.name}`, Tagging: { TagSet: expectedS3TagSet } }).promise()));

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
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      deleteCollection({
        prefix: config.stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      }),
      deleteProvider({ prefix: config.stackName, providerId: provider.id }),
      executionModel.delete({ arn: workflowExecutionArn }),
      removePublishedGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
      }),
      pdrModel.delete({
        pdrName: inputPayload.pdr.name,
      }),
    ]);
  });

  it('makes the granule available through the Cumulus API', async () => {
    await waitForGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId,
      status: 'completed',
    });
    const granuleResponse = await getGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId,
    });
    granuleResult = JSON.parse(granuleResponse.body);
    expect(granuleResult.granuleId).toEqual(inputPayload.granules[0].granuleId);
    expect(granuleResult.status).toEqual('completed');
  });

  it('has a checksum file that matches the ingested granule file', async () => {
    const md5File = granuleResult.files.find((f) => f.key.match('.hdf.md5'));
    const dataFile = granuleResult.files.find((f) => f.key.match('.hdf$'));
    const dataStream = await s3().getObject({ Bucket: dataFile.bucket, Key: dataFile.key }).createReadStream();
    const dataHash = await hasha.fromStream(dataStream, { algorithm: 'md5', encoding: 'hex' });
    const md5FileContent = await s3().getObject({ Bucket: md5File.bucket, Key: md5File.key }).promise();

    expect(dataHash).toEqual(md5FileContent.Body.toString());
  });

  it('completes execution with success status', async () => {
    const workflowExecutionStatus = await waitForCompletedExecution(workflowExecutionArn);
    expect(workflowExecutionStatus).toEqual('SUCCEEDED');
  });

  it('results in the files being added to the granule files cache table', async () => {
    process.env.FilesTable = `${config.stackName}-FilesTable`;

    const executionOutput = await getExecutionOutput(workflowExecutionArn);

    await pMap(
      executionOutput.payload.granules[0].files,
      async (file) => {
        const { Bucket, Key } = parseS3Uri(file.filename);

        const granuleId = await pRetry(
          async () => {
            const id = await GranuleFilesCache.getGranuleId(Bucket, Key);
            if (id === undefined) throw new Error(`File not found in cache: s3://${Bucket}/${Key}`);
            return id;
          },
          { retries: 30, minTimeout: 2000, maxTimeout: 2000 }
        );

        expect(granuleId).toEqual(executionOutput.payload.granules[0].granuleId);
      },
      { concurrency: 1 }
    );
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
