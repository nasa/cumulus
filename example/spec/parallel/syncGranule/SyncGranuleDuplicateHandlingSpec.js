'use strict';

const fs = require('fs');

const { s3 } = require('@cumulus/aws-client/services');
const { s3Join } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { getGranule } = require('@cumulus/api-client/granules');
const { deleteExecution } = require('@cumulus/api-client/executions');
const {
  addCollections,
  addProviders,
  api: apiTestUtils,
  cleanupCollections,
  cleanupProviders,
} = require('@cumulus/integration-tests');
const { getExecutionUrlFromArn } = require('@cumulus/message/Executions');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const {
  deleteFolder,
  loadConfig,
  templateFile,
  createTestDataPath,
  createTimestampedTestId,
  createTestSuffix,
  getFilesMetadata,
  uploadTestDataToBucket,
} = require('../../helpers/testUtils');
const {
  loadFileWithUpdatedGranuleIdPathAndCollection,
  setupTestGranuleForIngest,
  waitForGranuleAndDelete,
} = require('../../helpers/granuleUtils');
const {
  waitForApiRecord,
} = require('../../helpers/apiUtils');

const workflowName = 'SyncGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
];
const inputPayloadFilename = './spec/parallel/syncGranule/SyncGranule.input.payload.json';

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';

describe('When the Sync Granule workflow is configured', () => {
  let caughtDuplicateErrorExecutionArn;
  let collection;
  let config;
  let duplicateChecksumExecutionArn;
  let duplicateFilenameExecutionArn;
  let existingVersionedFileExecutionArn;
  let expectedPayload;
  let inputPayload;
  let lambdaStep;
  let newGranuleId;
  let provider;
  let syncGranuleExecutionArn;
  let testDataFolder;
  let testSuffix;
  let uncaughtDuplicateErrorExecutionArn;
  let workflowExecution;

  beforeAll(async () => {
    config = await loadConfig();
    lambdaStep = new LambdaStep();

    const testId = createTimestampedTestId(config.stackName, 'SyncGranuleDuplicateHandling');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    provider = { id: `s3_provider${testSuffix}` };
    const newCollectionId = constructCollectionId(collection.name, collection.version);

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
    ]);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');

    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
    newGranuleId = inputPayload.granules[0].granuleId;

    const templatedOutputPayloadFilename = templateFile({
      inputTemplateFilename: './spec/parallel/syncGranule/SyncGranule.output.payload.template.json',
      config: {
        granules: [
          {
            files: [
              {
                bucket: config.buckets.internal.name,
                key: `custom-staging-dir/${config.stackName}/replace-me-collectionId/replace-me-granuleId.hdf`,
                source: `${testDataFolder}/replace-me-granuleId.hdf`,
              },
              {
                bucket: config.buckets.internal.name,
                key: `custom-staging-dir/${config.stackName}/replace-me-collectionId/replace-me-granuleId.hdf.met`,
                source: `${testDataFolder}/replace-me-granuleId.hdf.met`,
              },
            ],
          },
        ],
      },
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

    syncGranuleExecutionArn = workflowExecution.executionArn;
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all(inputPayload.granules.map(
      async (granule) => {
        await waitForGranuleAndDelete(
          config.stackName,
          granule.granuleId,
          constructCollectionId(collection.name, collection.version),
          ['completed', 'failed']
        );
      }
    ));

    // Executions must be deleted in a specific order due to foreign key relationships
    await deleteExecution({ prefix: config.stackName, executionArn: caughtDuplicateErrorExecutionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: uncaughtDuplicateErrorExecutionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: existingVersionedFileExecutionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: duplicateFilenameExecutionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: duplicateChecksumExecutionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: syncGranuleExecutionArn });

    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
    ]);
  });

  describe('to keep both files when encountering duplicate filenames\n', () => {
    it('the initial workflow completes execution with success status', () => {
      expect(workflowExecution.status).toEqual('completed');
    });

    describe('and it encounters data with a duplicated filename with duplicate checksum', () => {
      let lambdaOutput;
      let existingfiles;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
        const files = lambdaOutput.payload.granules[0].files;
        existingfiles = await getFilesMetadata(files);
        const [file1, file2] = expectedPayload.granules[0].files;
        // expect reporting of duplicates
        expectedPayload.granuleDuplicates = {
          [expectedPayload.granules[0].granuleId]: {
            files: [
              {
                bucket: file1.bucket,
                key: file1.key,
              },
              {
                bucket: file2.bucket,
                key: file2.key,
              },
            ],
          },
        };

        // set collection duplicate handling to 'version'
        await apiTestUtils.updateCollection({
          prefix: config.stackName,
          collection,
          updateParams: { duplicateHandling: 'version' },
        });

        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName, config.bucket, workflowName, collection, provider, inputPayload
        );

        duplicateChecksumExecutionArn = workflowExecution.executionArn;
      });

      afterAll(() => {
        // delete reporting expectations
        delete expectedPayload.granuleDuplicates;
      });

      it('does not raise a workflow error', () => {
        expect(workflowExecution.status).toEqual('completed');
      });

      it('does not create a copy of the file', async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
        const files = lambdaOutput.payload.granules[0].files;
        const currentFiles = await getFilesMetadata(files);

        const updatedGranule = {
          ...expectedPayload.granules[0],
          sync_granule_duration: lambdaOutput.payload.granules[0].sync_granule_duration,
          createdAt: lambdaOutput.payload.granules[0].createdAt,
          provider: provider.id,
        };

        const updatedExpectedPayload = {
          ...expectedPayload,
          granules: [updatedGranule],
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
          Bucket: config.bucket, Key: s3Join(file.path, file.name), Body: content,
        };

        await s3().putObject(updateParams);
        inputPayload.granules[0].files[0].size = content.length;

        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName, config.bucket, workflowName, collection, provider, inputPayload
        );

        duplicateFilenameExecutionArn = workflowExecution.executionArn;
      });

      it('does not raise a workflow error', () => {
        expect(workflowExecution.status).toEqual('completed');
      });

      it('moves the existing data to a file with a suffix to distinguish it from the new file', async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
        const files = lambdaOutput.payload.granules[0].files;
        expect(files.length).toEqual(3);

        const renamedFiles = files.filter((f) => f.fileName.startsWith(`${fileUpdated}.v`));
        expect(renamedFiles.length).toEqual(1);

        const expectedRenamedFileSize = existingfiles.filter((f) => f.key.endsWith(fileUpdated))[0].size;
        expect(renamedFiles[0].size).toEqual(expectedRenamedFileSize);
      });

      it('captures the additional file', async () => {
        // This assertion is to check that the granule has been updated in the API
        // before performing further checks
        const granule = await waitForApiRecord(
          getGranule,
          {
            prefix: config.stackName,
            granuleId: inputPayload.granules[0].granuleId,
          },
          {
            status: 'completed',
            execution: getExecutionUrlFromArn(duplicateFilenameExecutionArn),
          }
        );
        expect(granule.status).toEqual('completed');
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
          Bucket: config.bucket, Key: s3Join(file.path, file.name), Body: content,
        };

        await s3().putObject(updateParams);
        inputPayload.granules[0].files[0].size = content.length;

        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName, config.bucket, workflowName, collection, provider, inputPayload
        );

        existingVersionedFileExecutionArn = workflowExecution.executionArn;
      });

      it('does not raise a workflow error', () => {
        expect(workflowExecution.status).toEqual('completed');
      });

      it('moves the existing data to a file with a suffix to distinguish it from the new file and existing versioned file', async () => {
        lambdaOutput = await lambdaStep.getStepOutput(existingVersionedFileExecutionArn, 'SyncGranule');
        const files = lambdaOutput.payload.granules[0].files;
        expect(files.length).toEqual(4);

        const renamedFiles = files.filter((f) => f.fileName.startsWith(`${updatedFileName}.v`));
        expect(renamedFiles.length).toEqual(2);
      });

      it('captures all files', async () => {
        const granule = await waitForApiRecord(
          getGranule,
          {
            prefix: config.stackName,
            granuleId: inputPayload.granules[0].granuleId,
          },
          {
            status: 'completed',
            execution: getExecutionUrlFromArn(existingVersionedFileExecutionArn),
          }
        );
        expect(granule.status).toEqual('completed');
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
          updateParams: { duplicateHandling: 'error' },
        });

        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName, config.bucket, workflowName, collection, provider, inputPayload
        );

        uncaughtDuplicateErrorExecutionArn = workflowExecution.executionArn;
      });

      it('configured collection to handle duplicates as error', async () => {
        const lambdaInput = await lambdaStep.getStepInput(uncaughtDuplicateErrorExecutionArn, 'SyncGranule');
        expect(lambdaInput.meta.collection.duplicateHandling).toEqual('error');
      });

      it('fails the SyncGranule Lambda function', async () => {
        const lambdaOutput = await lambdaStep.getStepOutput(uncaughtDuplicateErrorExecutionArn, 'SyncGranule', 'failure');
        const { error, cause } = lambdaOutput;
        const errorCause = JSON.parse(cause);
        expect(error).toEqual('DuplicateFile');
        expect(errorCause.errorMessage).toMatch(
          new RegExp(`.* already exists in ${config.bucket} bucket`)
        );
      });

      it('fails the workflow', () => {
        expect(workflowExecution.status).toEqual('failed');
      });

      it('sets granule status to "failed"', async () => {
        const granule = await waitForApiRecord(
          getGranule,
          {
            prefix: config.stackName,
            granuleId: inputPayload.granules[0].granuleId,
          },
          {
            status: 'failed',
            execution: getExecutionUrlFromArn(uncaughtDuplicateErrorExecutionArn),
          }
        );
        expect(granule.status).toEqual('failed');
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
        caughtDuplicateErrorExecutionArn = workflowExecution.executionArn;
      });

      it('configured collection to handle duplicates as error', async () => {
        const lambdaInput = await lambdaStep.getStepInput(caughtDuplicateErrorExecutionArn, 'SyncGranule');
        expect(lambdaInput.meta.collection.duplicateHandling).toEqual('error');
      });

      it('fails the SyncGranule Lambda function', async () => {
        const lambdaOutput = await lambdaStep.getStepOutput(caughtDuplicateErrorExecutionArn, 'SyncGranule', 'failure');
        const { error, cause } = lambdaOutput;
        const errorCause = JSON.parse(cause);
        expect(error).toEqual('DuplicateFile');
        expect(errorCause.errorMessage).toMatch(
          new RegExp(`.* already exists in ${config.bucket} bucket`)
        );
      });

      it('completes execution with success status', () => {
        expect(workflowExecution.status).toEqual('completed');
      });

      it('sets granule status to "failed"', async () => {
        // Granule status will be "failed" even though workflow
        // succeeded because file bucket/key properties were not
        // generated since SyncGranule failed
        const granule = await waitForApiRecord(
          getGranule,
          {
            prefix: config.stackName,
            granuleId: inputPayload.granules[0].granuleId,
          },
          {
            status: 'failed',
            execution: getExecutionUrlFromArn(caughtDuplicateErrorExecutionArn),
          }
        );
        expect(granule.status).toEqual('failed');
      });
    });
  });
});
