'use strict';

const fs = require('fs-extra');
const path = require('path');
const { Collection } = require('@cumulus/api/models');
const {
  aws: { s3 },
  testUtils: { randomString }
} = require('@cumulus/common');
const {
  api: apiTestUtils,
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  LambdaStep
} = require('@cumulus/integration-tests');
const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  getFilesMetadata
} = require('../helpers/testUtils');
const { setupTestGranuleForIngest } = require('../helpers/granuleUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();
// the workflow has no cmrstep
const workflowName = 'IngestGranuleCatchDuplicateErrorTest';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

describe('When the Ingest Granules workflow is configured to keep both files when encountering duplicate filenames\n', () => {
  const testId = createTimestampedTestId(config.stackName, 'IngestGranuleDuplicateHandlingVersion');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);
  const inputPayloadFilename = './spec/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };
  let workflowExecution;
  let inputPayload;

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const collectionModel = new Collection();

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);

    // set collection duplicate handling to 'error'
    await collectionModel.update(collection, { duplicateHandling: 'version' });

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      apiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      })
    ]);
  });

  it('completes execution with success status', async () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('and it encounters data with a duplicated filename with duplicate checksum', () => {
    let lambdaOutput;
    let existingfiles;
    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      existingfiles = await getFilesMetadata(lambdaOutput.payload.granules[0].files);
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, inputPayload
      );
    });

    it('does not raise a workflow error', () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });

    it('does not create a copy of the file', async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      const files = lambdaOutput.payload.granules[0].files;
      const currentFiles = await getFilesMetadata(files);
      // excludes the .cmr.xml file which is updated with online resources
      expect(currentFiles.filter((f) => !f.filename.endsWith('.cmr.xml')))
        .toEqual(existingfiles.filter((f) => !f.filename.endsWith('.cmr.xml')));
    });
  });

  describe('and it encounters data with a duplicated filename with different checksum', () => {
    let lambdaOutput;
    let existingfiles;
    let fileUpdated;
    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      existingfiles = await getFilesMetadata(lambdaOutput.payload.granules[0].files);
      // update one of the input files, so that the file has different checksum
      const content = randomString();
      const file = inputPayload.granules[0].files[0];
      fileUpdated = file.name;
      const updateParams = {
        Bucket: config.bucket, Key: path.join(file.path, file.name), Body: content
      };

      await s3().putObject(updateParams).promise();
      inputPayload.granules[0].files[0].fileSize = content.length;

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, inputPayload
      );
    });

    it('does not raise a workflow error', () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });

    it('moves the existing data to a file with a suffix to distinguish it from the new file', async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      const files = lambdaOutput.payload.granules[0].files;
      expect(files.length).toEqual(5);

      const renamedFiles = files.filter((f) => f.name.startsWith(`${fileUpdated}.v`));
      expect(renamedFiles.length).toEqual(1);

      const expectedRenamedFileSize = existingfiles.filter((f) => f.filename.endsWith(fileUpdated))[0].fileSize;
      expect(renamedFiles[0].fileSize).toEqual(expectedRenamedFileSize);
    });

    it('captures both files', async () => {
      const granule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      expect(granule.files.length).toEqual(5);
    });
  });

  describe('and it encounters data with a duplicated filename with different checksum and there is an existing versioned file', () => {
    let lambdaOutput;
    let updatedFileName;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');

      // update one of the input files, so that the file has different checksum
      const content = randomString();
      const file = inputPayload.granules[0].files[0];
      updatedFileName = file.name;
      const updateParams = {
        Bucket: config.bucket, Key: path.join(file.path, file.name), Body: content
      };

      await s3().putObject(updateParams).promise();
      inputPayload.granules[0].files[0].fileSize = content.length;

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, inputPayload
      );
    });

    it('does not raise a workflow error', () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });

    it('moves the existing data to a file with a suffix to distinguish it from the new file and existing versioned file', async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      const files = lambdaOutput.payload.granules[0].files;
      expect(files.length).toEqual(6);

      const renamedFiles = files.filter((f) => f.name.startsWith(`${updatedFileName}.v`));
      expect(renamedFiles.length).toEqual(2);
    });

    it('captures all files', async () => {
      const granule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      expect(granule.files.length).toEqual(6);
    });
  });
});
