'use strict';

const fs = require('fs-extra');
const path = require('path');
const {
  models: { Granule, Collection }
} = require('@cumulus/api');
const {
  aws: { s3 },
  constructCollectionId,
  stringUtils: { globalReplace },
  testUtils: { randomString }
} = require('@cumulus/common');
const {
  buildAndExecuteWorkflow,
  LambdaStep
} = require('@cumulus/integration-tests');
const { api: apiTestUtils } = require('@cumulus/integration-tests');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  timestampedTestDataPrefix,
  getFilesMetadata
} = require('../helpers/testUtils');
const {
  setupTestGranuleForIngest
} = require('../helpers/granuleUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();

const workflowName = 'MoveGranules';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';
const fileStagingDir = 'file-staging';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met'
];

describe('The Move Granules workflow', () => {
  const testDataFolder = timestampedTestDataPrefix(`${config.stackName}-MoveGranulesDuplicateSuccess`);
  const inputPayloadFilename = './spec/moveGranules/MoveGranules.input.payload.json';
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  let workflowExecution = null;
  let inputPayload;
  let stagingFileDir;

  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  const granuleModel = new Granule();
  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const collectionModel = new Collection();

  beforeAll(async () => {
    // upload test data
    await uploadTestDataToBucket(config.bucket, s3data, testDataFolder, true);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    const updatedInputPayloadJson = globalReplace(inputPayloadJson, 'cumulus-test-data/pdrs', testDataFolder);
    inputPayload = await setupTestGranuleForIngest(config.bucket, updatedInputPayloadJson, testDataGranuleId, granuleRegex);

    // delete the granule record from DynamoDB if exists
    await granuleModel.delete({ granuleId: inputPayload.granules[0].granuleId });

    const collectionInfo = await collectionModel.get(collection);
    stagingFileDir = path.join(
      fileStagingDir,
      config.stackName,
      constructCollectionId(collectionInfo.dataType, collectionInfo.version)
    );

    // eslint-disable-next-line function-paren-newline
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      inputPayload
    );
  });

  afterAll(async () => {
    await Promise.all([
      // delete ingested granule
      apiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      }),
      // Remove the granule files added for the test
      deleteFolder(config.bucket, testDataFolder),
      deleteFolder(config.bucket, stagingFileDir)
    ]);
  });

  it('completes the first execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('encounters duplicate filenames', () => {
    let lambdaOutput;
    let files;
    let existingFiles;
    let fileUpdated;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      files = lambdaOutput.payload.granules[0].files;
      existingFiles = await getFilesMetadata(files);

      // update one of the input files so we can assert that the file size changed
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

    it('overwrites the existing file with the new data', async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      const outputFiles = lambdaOutput.payload.granules[0].files;
      const currentFiles = await getFilesMetadata(outputFiles);

      expect(currentFiles.length).toBe(existingFiles.length);

      currentFiles.forEach((cf) => {
        const existingfile = existingFiles.filter((ef) => ef.filename === cf.filename);
        expect(cf.LastModified).toBeGreaterThan(existingfile[0].LastModified);
        if (cf.filename.endsWith(fileUpdated)) {
          expect(cf.fileSize).toBe(inputPayload.granules[0].files[0].fileSize);
        }
      });
    });
  });
});
