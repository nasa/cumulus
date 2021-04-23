'use strict';

const fs = require('fs-extra');
const get = require('lodash/get');

const { Granule } = require('@cumulus/api/models');
const {
  deleteS3Object,
  parseS3Uri,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { sfn } = require('@cumulus/aws-client/services');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { bulkOperation, removePublishedGranule } = require('@cumulus/api-client/granules');
const { listRequests } = require('@cumulus/api-client/orca');
const { deleteProvider } = require('@cumulus/api-client/providers');
const {
  addCollections,
  addProviders,
  buildAndStartWorkflow,
  waitForAsyncOperationStatus,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');

const { waitForModelStatus } = require('../../helpers/apiUtils');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
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
const recoveryWorkflowName = 'DrRecoveryWorkflow';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
];

const providersDir = './data/providers/s3/';
// TODO use ./data/collections/s3_MOD09GQ_006_full_ingest
// after ORCA tickets are fixed ORCA-140, ORCA-144
const collectionsDir = './data/collections/s3_MOD09GQ_006_orca';

async function stateMachineExists(stateMachineName) {
  const sfnList = await sfn().listStateMachines({ maxResults: 1 }).promise();
  const stateMachines = get(sfnList, 'stateMachines', []);
  if (stateMachines.length !== 1) {
    console.log('No state machine found');
    return false;
  }
  const stateMachineArn = stateMachines[0].stateMachineArn.replace(stateMachines[0].name, stateMachineName);
  try {
    await StepFunctions.describeStateMachine({ stateMachineArn });
  } catch (error) {
    if (error.code === 'StateMachineDoesNotExist') return false;
    throw error;
  }
  return true;
}

describe('The S3 Ingest Granules workflow', () => {
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';

  let isOrcaIncluded = true;
  let collection;
  let config;
  let granuleModel;
  let inputPayload;
  let provider;
  let testDataFolder;
  let workflowExecutionArn;
  let granuleId;
  let filesCopiedToGlacier;

  beforeAll(async () => {
    config = await loadConfig();

    // check if orca is deployed
    const stateMachineName = `${config.stackName}-${workflowName}`;
    isOrcaIncluded = await stateMachineExists(stateMachineName);
    if (!isOrcaIncluded) {
      console.log(`${stateMachineName} doesn't exist, skip the tests...`);
      return;
    }

    const testId = createTimestampedTestId(config.stackName, 'OrcaBackupAndRecovery');
    const testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    provider = { id: `s3_provider${testSuffix}` };

    process.env.GranulesTable = `${config.stackName}-GranulesTable`;
    granuleModel = new Granule();

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
    ]);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
    granuleId = inputPayload.granules[0].granuleId;

    workflowExecutionArn = await buildAndStartWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    if (!isOrcaIncluded) return;

    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      deleteCollection({
        prefix: config.stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      }),
      deleteProvider({ prefix: config.stackName, providerId: get(provider, 'id') }),
      removePublishedGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
      }),
    ]);
  });

  it('completes execution with success status', async () => {
    if (!isOrcaIncluded) pending();

    const workflowExecutionStatus = await waitForCompletedExecution(workflowExecutionArn);
    expect(workflowExecutionStatus).toEqual('SUCCEEDED');
  });

  describe('the CopyToGlacier task', () => {
    let lambdaOutput;

    beforeAll(async () => {
      if (!isOrcaIncluded) return;
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecutionArn, 'copy_to_glacier');
    });

    it('copies files configured to glacier', async () => {
      if (!isOrcaIncluded) pending();

      // TODO after ORCA fixes their iam to support multiple 'protected' buckets,
      // update collection configure to place '.cmr.xml' in protected-2 bucket,
      // and verify .cmr.xml file is copied from protected-2 bucket to glacier
      // ORCA ticket https://bugs.earthdata.nasa.gov/browse/ORCA-140
      const excludeFileTypes = get(lambdaOutput, 'meta.collection.meta.excludeFileTypes', []);
      expect(excludeFileTypes.length).toBe(0);
      filesCopiedToGlacier = get(lambdaOutput, 'payload.copied_to_glacier', []);
      expect(filesCopiedToGlacier.length).toBe(4);

      // copiedToGlacier contains a list of the file s3uri in primary buckets
      const copiedOver = await Promise.all(
        filesCopiedToGlacier.map((s3uri) => {
          expect(excludeFileTypes.filter((type) => s3uri.endsWith(type)).length).toBe(0);
          return s3ObjectExists({ Bucket: config.buckets.glacier.name, Key: parseS3Uri(s3uri).Key });
        })
      );
      copiedOver.forEach((check) => expect(check).toEqual(true));
    });
  });

  describe('the recovery workflow', () => {
    let asyncOperationId;

    it('generates an async operation through the Cumulus API', async () => {
      if (!isOrcaIncluded) pending();

      const response = await bulkOperation({
        prefix: config.stackName,
        ids: [granuleId],
        workflowName: recoveryWorkflowName,
      });

      const responseBody = JSON.parse(response.body);
      asyncOperationId = responseBody.id;
      expect(asyncOperationId).toBeTruthy();
    });

    it('starts the recovery workflow', async () => {
      if (!isOrcaIncluded) pending();

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

      await waitForModelStatus(
        granuleModel,
        { granuleId },
        'completed'
      );
    });

    it('retrieves recovery request status through the Cumulus API', async () => {
      if (!isOrcaIncluded) pending();

      const response = await listRequests({
        prefix: config.stackName,
        query: { asyncOperationId, granuleId },
      });
      const requests = JSON.parse(response.body);
      const status = ['inprogress', 'complete'];

      // RecoveryWorkflow currently works only when all granule files are copied to galacier,
      // TODO update the collection configuration to exclude files after ORCA-144
      expect(requests.length).toBe(4);

      // TODO check asyncOperationId in request status after it's part of the request status
      // CUMULUS-2414/ORCA ticket
      const checkRequests = requests.map((request) => request.granule_id === granuleId && status.includes(request.job_status));
      checkRequests.forEach((check) => expect(check).toEqual(true));
    });
  });

  // TODO remove the glacier files via ORCA API when the API is available (PI 21.3 21.4)
  it('removes files from glacier', async () => {
    if (!isOrcaIncluded) pending();
    await Promise.all(filesCopiedToGlacier.map((s3uri) => deleteS3Object(config.buckets.glacier.name, parseS3Uri(s3uri).Key)));
    const deletedFromGlacier = await Promise.all(filesCopiedToGlacier.map((s3uri) => s3ObjectExists({ Bucket: config.buckets.glacier.name, Key: parseS3Uri(s3uri).Key })));
    deletedFromGlacier.forEach((check) => expect(check).toEqual(false));
  });
});
