'use strict';

const fs = require('fs');
const path = require('path');
const {
  aws: { s3 },
  constructCollectionId,
  testUtils: {
    randomString
  }
} = require('@cumulus/common');
const { LambdaStep } = require('@cumulus/common/sfnStep');
const { models: { Granule, Pdr } } = require('@cumulus/api');
const {
  addCollections,
  addProviders,
  api: apiTestUtils,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  granulesApi: granulesApiTestUtils
} = require('@cumulus/integration-tests');
const {
  deleteFolder,
  loadConfig,
  templateFile,
  createTestDataPath,
  createTimestampedTestId,
  createTestSuffix,
  getFilesMetadata,
  uploadTestDataToBucket
} = require('../../helpers/testUtils');
const {
  loadFileWithUpdatedGranuleIdPathAndCollection,
  setupTestGranuleForIngest
} = require('../../helpers/granuleUtils');
const { waitForModelStatus } = require('../../helpers/apiUtils');

const workflowName = 'SyncGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf'
];

const inputPayloadFilename = './spec/parallel/syncGranule/SyncGranule.input.payload.json';

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';

describe('When the Sync Granule workflow is configured', () => {
  let config;
  let lambdaStep;
  let workflowExecution;
  let collection;
  let provider;
  let inputPayload;
  let granuleModel;
  let expectedPayload;
  let pdrModel;
  let testSuffix;
  let testDataFolder;

  beforeAll(async () => {
    config = await loadConfig();
    lambdaStep = new LambdaStep();

    const testId = createTimestampedTestId(config.stackName, 'SyncGranuleDuplicateHandling');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    provider = { id: `s3_provider${testSuffix}` };
    const newCollectionId = constructCollectionId(collection.name, collection.version);

    process.env.GranulesTable = `${config.stackName}-GranulesTable`;
    granuleModel = new Granule();

    process.env.PdrsTable = `${config.stackName}-PdrsTable`;
    pdrModel = new Pdr();

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');

    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
    const newGranuleId = inputPayload.granules[0].granuleId;

    const templatedOutputPayloadFilename = templateFile({
      inputTemplateFilename: './spec/parallel/syncGranule/SyncGranule.output.payload.template.json',
      config: {
        granules: [
          {
            files: [
              {
                bucket: config.buckets.internal.name,
                filename: `s3://${config.buckets.internal.name}/custom-staging-dir/${config.stackName}/replace-me-collectionId/replace-me-granuleId.hdf`,
                fileStagingDir: `custom-staging-dir/${config.stackName}/replace-me-collectionId`
              },
              {
                bucket: config.buckets.internal.name,
                filename: `s3://${config.buckets.internal.name}/custom-staging-dir/${config.stackName}/replace-me-collectionId/replace-me-granuleId.hdf.met`,
                fileStagingDir: `custom-staging-dir/${config.stackName}/replace-me-collectionId`
              }
            ]
          }
        ]
      }
    });

    expectedPayload = loadFileWithUpdatedGranuleIdPathAndCollection(
      templatedOutputPayloadFilename,
      newGranuleId,
      testDataFolder,
      newCollectionId,
      config.stackName
    );
    expectedPayload.granules[0].dataType += testSuffix;

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
      granulesApiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      }),
      pdrModel.delete({
        pdrName: inputPayload.pdr.name
      })
    ]);
  });

  describe('to keep both files when encountering duplicate filenames\n', () => {
    it('the initial workflow completes execution with success status', () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });

    describe('and it encounters data with a duplicated filename with duplicate checksum', () => {
      let lambdaOutput;
      let existingfiles;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
        const files = lambdaOutput.payload.granules[0].files;
        existingfiles = await getFilesMetadata(files);
        // expect reporting of duplicates
        expectedPayload.granules[0].files[0].duplicate_found = true;
        expectedPayload.granules[0].files[1].duplicate_found = true;

        // set collection duplicate handling to 'version'
        await apiTestUtils.updateCollection({
          prefix: config.stackName,
          collection,
          updateParams: { duplicateHandling: 'version' }
        });

        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName, config.bucket, workflowName, collection, provider, inputPayload
        );
      });

      afterAll(() => {
        // delete reporting expectations
        delete expectedPayload.granules[0].files[0].duplicate_found;
        delete expectedPayload.granules[0].files[1].duplicate_found;
      });

      it('does not raise a workflow error', () => {
        expect(workflowExecution.status).toEqual('SUCCEEDED');
      });

      it('does not create a copy of the file', async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
        const files = lambdaOutput.payload.granules[0].files;
        const currentFiles = await getFilesMetadata(files);

        const updatedGranule = {
          ...expectedPayload.granules[0],
          sync_granule_duration: lambdaOutput.payload.granules[0].sync_granule_duration
        };

        const updatedExpectedPayload = {
          ...expectedPayload,
          granules: [updatedGranule]
        };

        expect(currentFiles).toEqual(existingfiles);
        expect(lambdaOutput.payload).toEqual(updatedExpectedPayload);
      });
    });

    describe('and it encounters data with a duplicated filename with different checksum', () => {
      let lambdaOutput;
      let existingfiles;
      let fileUpdated;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
        const files = lambdaOutput.payload.granules[0].files;
        existingfiles = await getFilesMetadata(files);

        // update one of the input files, so that the file has different checksum
        const content = randomString();
        const file = inputPayload.granules[0].files[0];
        fileUpdated = file.name;
        const updateParams = {
          Bucket: config.bucket, Key: path.join(file.path, file.name), Body: content
        };

        await s3().putObject(updateParams).promise();
        inputPayload.granules[0].files[0].size = content.length;

        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName, config.bucket, workflowName, collection, provider, inputPayload
        );
      });

      it('does not raise a workflow error', () => {
        expect(workflowExecution.status).toEqual('SUCCEEDED');
      });

      it('moves the existing data to a file with a suffix to distinguish it from the new file', async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
        const files = lambdaOutput.payload.granules[0].files;
        expect(files.length).toEqual(3);

        const renamedFiles = files.filter((f) => f.name.startsWith(`${fileUpdated}.v`));
        expect(renamedFiles.length).toEqual(1);

        const expectedRenamedFileSize = existingfiles.filter((f) => f.filename.endsWith(fileUpdated))[0].size;
        expect(renamedFiles[0].size).toEqual(expectedRenamedFileSize);
      });

      it('captures both files', async () => {
        // This assertion is to check that the granule has been updated in dynamo
        // before performing further checks
        const record = await waitForModelStatus(
          granuleModel,
          { granuleId: inputPayload.granules[0].granuleId },
          'completed'
        );
        expect(record.status).toEqual('completed');

        const granuleResponse = await granulesApiTestUtils.getGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });
        const granule = JSON.parse(granuleResponse.body);
        expect(granule.files.length).toEqual(3);
      });
    });

    describe('and it encounters data with a duplicated filename with different checksum and there is an existing versioned file', () => {
      let lambdaOutput;
      let updatedFileName;

      beforeAll(async () => {
        // update one of the input files, so that the file has different checksum
        const content = randomString();
        const file = inputPayload.granules[0].files[0];
        updatedFileName = file.name;
        const updateParams = {
          Bucket: config.bucket, Key: path.join(file.path, file.name), Body: content
        };

        await s3().putObject(updateParams).promise();
        inputPayload.granules[0].files[0].size = content.length;

        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName, config.bucket, workflowName, collection, provider, inputPayload
        );
      });

      it('does not raise a workflow error', () => {
        expect(workflowExecution.status).toEqual('SUCCEEDED');
      });

      it('moves the existing data to a file with a suffix to distinguish it from the new file and existing versioned file', async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
        const files = lambdaOutput.payload.granules[0].files;
        expect(files.length).toEqual(4);

        const renamedFiles = files.filter((f) => f.name.startsWith(`${updatedFileName}.v`));
        expect(renamedFiles.length).toEqual(2);
      });

      it('captures all files', async () => {
        const record = await waitForModelStatus(
          granuleModel,
          { granuleId: inputPayload.granules[0].granuleId },
          'completed'
        );
        expect(record.status).toEqual('completed');

        const granuleResponse = await granulesApiTestUtils.getGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });
        const granule = JSON.parse(granuleResponse.body);
        expect(granule.files.length).toEqual(4);
      });
    });
  });

  describe('to handle duplicates as "error"', () => {
    describe('and it is not configured to catch the duplicate error', () => {
      beforeAll(async () => {
        // set collection duplicate handling to 'error'
        await apiTestUtils.updateCollection({
          prefix: config.stackName,
          collection,
          updateParams: { duplicateHandling: 'error' }
        });

        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName, config.bucket, workflowName, collection, provider, inputPayload
        );
      });

      it('configured collection to handle duplicates as error', async () => {
        const lambdaInput = await lambdaStep.getStepInput(workflowExecution.executionArn, 'SyncGranule');
        expect(lambdaInput.meta.collection.duplicateHandling).toEqual('error');
      });

      it('fails the SyncGranule Lambda function', async () => {
        const lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule', 'failure');
        const { error, cause } = lambdaOutput;
        const errorCause = JSON.parse(cause);
        expect(error).toEqual('DuplicateFile');
        expect(errorCause.errorMessage).toMatch(
          new RegExp(`.* already exists in ${config.bucket} bucket`)
        );
      });

      it('fails the workflow', () => {
        expect(workflowExecution.status).toEqual('FAILED');
      });
    });

    describe('and it is configured to catch the duplicate error', () => {
      beforeAll(async () => {
        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName,
          config.bucket,
          'SyncGranuleCatchDuplicateErrorTest',
          collection,
          provider,
          inputPayload
        );
      });

      it('configured collection to handle duplicates as error', async () => {
        const lambdaInput = await lambdaStep.getStepInput(workflowExecution.executionArn, 'SyncGranule');
        expect(lambdaInput.meta.collection.duplicateHandling).toEqual('error');
      });

      it('fails the SyncGranule Lambda function', async () => {
        const lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule', 'failure');
        const { error, cause } = lambdaOutput;
        const errorCause = JSON.parse(cause);
        expect(error).toEqual('DuplicateFile');
        expect(errorCause.errorMessage).toMatch(
          new RegExp(`.* already exists in ${config.bucket} bucket`)
        );
      });

      it('completes execution with success status', async () => {
        expect(workflowExecution.status).toEqual('SUCCEEDED');
      });
    });
  });
});
