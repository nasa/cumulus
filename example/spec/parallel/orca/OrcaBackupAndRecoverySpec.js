'use strict';

const fs = require('fs-extra');
const get = require('lodash/get');
const pRetry = require('p-retry');

const {
  deleteS3Object,
  parseS3Uri,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { getCollection } = require('@cumulus/api-client/collections');
const { bulkOperation, getGranule, listGranules } = require('@cumulus/api-client/granules');
const { submitRequestToOrca } = require('@cumulus/api-client/orca');
const { deleteProvider } = require('@cumulus/api-client/providers');
const {
  addCollections,
  addProviders,
  waitForAsyncOperationStatus,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { encodedConstructCollectionId } = require('../../helpers/Collections');
const { removeCollectionAndAllDependencies } = require('../../helpers/Collections');
const { buildAndStartWorkflow } = require('../../helpers/workflowUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');
const {
  setupTestGranuleForIngest,
  waitForGranuleRecordsInList,
} = require('../../helpers/granuleUtils');
const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
} = require('../../helpers/testUtils');

const lambdaStep = new LambdaStep();
const workflowName = 'IngestAndPublishGranuleWithOrca';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
];

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006_full_ingest';
let collection;

describe('The S3 Ingest Granules workflow', () => {
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';

  let config;
  let inputPayload;
  let provider;
  let testDataFolder;
  let workflowExecutionArn;
  let granuleId;
  let filesCopiedToOrca;

  beforeAll(async () => {
    config = await loadConfig();

    const testId = createTimestampedTestId(config.stackName, 'OrcaBackupAndRecovery');
    const testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    provider = { id: `s3_provider${testSuffix}` };

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
    ]);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(
      config.bucket,
      JSON.stringify({ ...JSON.parse(inputPayloadJson), pdr: undefined }),
      granuleRegex,
      testSuffix,
      testDataFolder
    );
    granuleId = inputPayload.granules[0].granuleId;

    workflowExecutionArn = await buildAndStartWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );

    await waitForApiStatus(
      getGranule,
      {
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
        collectionId: encodedConstructCollectionId(collection.name, collection.version),
      },
      'completed'
    );
  });

  afterAll(async () => {
    await removeCollectionAndAllDependencies({
      prefix: config.stackName,
      collection,
    });

    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      deleteProvider({ prefix: config.stackName, providerId: get(provider, 'id') }),
    ]);
  });

  it('completes execution with success status', async () => {
    const workflowExecutionStatus = await waitForCompletedExecution(workflowExecutionArn);
    expect(workflowExecutionStatus).toEqual('SUCCEEDED');
  });

  describe('the CopyToArchive task', () => {
    let lambdaOutput;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecutionArn, 'OrcaCopyToArchiveAdapter');
    });

    it('copies files configured to orca', async () => {
      const excludedFileExtensions = get(lambdaOutput, 'meta.collection.meta.orca.excludedFileExtensions', []);
      expect(excludedFileExtensions.length).toBe(1);
      filesCopiedToOrca = get(lambdaOutput, 'payload.copied_to_orca', []);
      expect(filesCopiedToOrca.length).toBe(3);

      // copiedToOrca contains a list of the file s3uri in primary buckets
      const copiedOver = await Promise.all(
        filesCopiedToOrca.map(async (s3uri) => {
          expect(excludedFileExtensions.filter((type) => s3uri.endsWith(type)).length).toBe(0);
          const parsedS3Uri = parseS3Uri(s3uri);
          await deleteS3Object(parsedS3Uri.Bucket, parsedS3Uri.Key);
          return s3ObjectExists({ Bucket: config.buckets.glacier.name, Key: parsedS3Uri.Key });
        })
      );
      copiedOver.forEach((check) => expect(check).toEqual(true));
    });
  });

  describe('the recovery workflow', () => {
    let asyncOperationId;

    it('generates an async operation through the Cumulus API', async () => {
      const collectionsApiResponse = await getCollection({
        prefix: config.stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      });

      if (collectionsApiResponse.statusCode) {
        throw new Error(`Collections API responded with error ${JSON.stringify(collectionsApiResponse)}`);
      }
      const recoveryWorkflowName = get(collectionsApiResponse, 'meta.granuleRecoveryWorkflow');

      const response = await bulkOperation({
        prefix: config.stackName,
        granules: [{
          granuleId,
          collectionId: encodedConstructCollectionId(collection.name, collection.version),
        }],
        workflowName: recoveryWorkflowName,
      });

      const responseBody = JSON.parse(response.body);
      asyncOperationId = responseBody.id;
      expect(asyncOperationId).toBeTruthy();
    });

    it('starts the recovery workflow', async () => {
      let asyncOperation;
      try {
        asyncOperation = await waitForAsyncOperationStatus({
          id: asyncOperationId,
          status: 'SUCCEEDED',
          stackName: config.stackName,
          retryOptions: {
            retries: 70,
            factor: 1.041,
          },
        });
      } catch (error) {
        fail(error);
      }

      const output = JSON.parse(asyncOperation.output);
      expect(output).toEqual([granuleId]);

      await waitForApiStatus(
        getGranule,
        {
          prefix: config.stackName,
          granuleId,
          collectionId: encodedConstructCollectionId(collection.name, collection.version),

        },
        'completed'
      );
      await waitForGranuleRecordsInList(config.stackName, [granuleId]);
    });

    it('retrieves recovery request job status through the Cumulus API', async () => {
      const request = await pRetry(
        async () => {
          const list = await submitRequestToOrca({
            prefix: config.stackName,
            httpMethod: 'POST',
            path: '/orca/recovery/jobs',
            body: { asyncOperationId },
          });
          const body = JSON.parse(list.body);
          if (body.httpStatus === 404) {
            throw new Error(`Waiting for recovery status become available, get message ${body.message}`);
          }
          return body;
        },
        {
          minTimeout: 60 * 1000,
        }
      );

      if (request.httpStatus) console.log(request);
      const status = ['pending', 'staged', 'success'];
      expect(request.asyncOperationId).toEqual(asyncOperationId);
      expect(request.granules.length).toBe(1);
      expect(request.granules[0].granuleId).toEqual(granuleId);
      expect(status.includes(request.granules[0].status)).toEqual(true);
    });

    it('retrieves recovery request granule status through the Cumulus API', async () => {
      const list = await submitRequestToOrca({
        prefix: config.stackName,
        httpMethod: 'POST',
        path: '/orca/recovery/granules',
        body: { asyncOperationId, granuleId },
      });
      const request = JSON.parse(list.body);
      if (request.httpStatus) console.log(request);
      const status = ['pending', 'staged', 'success'];
      expect(request.granuleId).toEqual(granuleId);
      expect(request.asyncOperationId).toEqual(asyncOperationId);
      expect(get(request, 'files', []).length).toBe(3);

      const checkRequests = get(request, 'files', []).map((file) => status.includes(file.status));
      checkRequests.forEach((check) => expect(check).toEqual(true));
    });
  });

  describe('The granule endpoint with getRecoveryStatus parameter set to true', () => {
    it('returns list of granules with recovery status', async () => {
      const response = await listGranules({
        prefix: config.stackName,
        query: {
          granuleId,
          getRecoveryStatus: true,
        },
      });

      const granules = JSON.parse(response.body).results;
      expect(granules.length).toBe(1);
      expect(granules[0].granuleId).toEqual(granuleId);
      expect(['completed', 'running'].includes(granules[0].recoveryStatus)).toBeTrue();
    });

    it('returns granule information with recovery status', async () => {
      const granule = await getGranule({
        prefix: config.stackName,
        granuleId,
        collectionId: encodedConstructCollectionId(collection.name, collection.version),
        query: { getRecoveryStatus: true },
      });
      expect(granule.granuleId).toEqual(granuleId);
      expect((granule.recoveryStatus === 'running') || (granule.recoveryStatus === 'completed')).toBeTrue();
    });
  });

  // TODO remove the glacier files via ORCA API when the API is available (PI 21.3 21.4)
  it('removes files from orca', async () => {
    await Promise.all(filesCopiedToOrca.map((s3uri) => deleteS3Object(config.buckets.glacier.name, parseS3Uri(s3uri).Key)));
    const deletedFromOrca = await Promise.all(filesCopiedToOrca.map((s3uri) => s3ObjectExists({ Bucket: config.buckets.glacier.name, Key: parseS3Uri(s3uri).Key })));
    deletedFromOrca.forEach((check) => expect(check).toEqual(false));
  });
});
