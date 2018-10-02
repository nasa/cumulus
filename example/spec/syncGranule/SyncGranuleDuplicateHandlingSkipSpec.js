const fs = require('fs');
const path = require('path');
const { Collection } = require('@cumulus/api/models');
const {
  aws: {
    headObject,
    parseS3Uri,
    s3
  },
  testUtils: {
    randomString
  }
} = require('@cumulus/common');
const {
  addCollections,
  addProviders,
  api: apiTestUtils,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  LambdaStep
} = require('@cumulus/integration-tests');
const {
  deleteFolder,
  loadConfig,
  templateFile,
  createTestDataPath,
  createTimestampedTestId,
  uploadTestDataToBucket
} = require('../helpers/testUtils');
const {
  loadFileWithUpdatedGranuleIdAndPath,
  setupTestGranuleForIngest
} = require('../helpers/granuleUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const workflowName = 'SyncGranuleDuplicateSkipTest';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';
const defaultDataFolder = 'cumulus-test-data/pdrs';

const outputPayloadTemplateFilename = './spec/syncGranule/SyncGranule.output.payload.template.json';
const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: outputPayloadTemplateFilename,
  config: config.SyncGranule
});

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

describe('When the Sync Granule workflow is configured to skip new data when encountering duplicate filenames', () => {
  const testId = createTimestampedTestId(config.stackName, 'SyncGranuleDuplicateHandlingSkip');
  const testSuffix = `_${testId}`;
  const testDataFolder = createTestDataPath(testId);

  const inputPayloadFilename = './spec/syncGranule/SyncGranule.input.payload.json';

  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };

  let inputPayload;
  let expectedPayload;
  let workflowExecution;

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const c = new Collection();

  beforeAll(async () => {
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);
    // set collection duplicate handling to 'skip'
    await c.update(collection, { duplicateHandling: 'skip' });

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, testDataGranuleId, granuleRegex, testSuffix, testDataFolder);
    const newGranuleId = inputPayload.granules[0].granuleId;

    expectedPayload = loadFileWithUpdatedGranuleIdAndPath(templatedOutputPayloadFilename, testDataGranuleId, newGranuleId, defaultDataFolder, testDataFolder);
    expectedPayload.granules[0].dataType += testSuffix;

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    // cleanup stack state changes added by test
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

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('and it encounters data with a duplicated filename', () => {
    let lambdaOutput;
    let existingfiles;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
      const files = lambdaOutput.payload.granules[0].files;
      existingfiles = await Promise.all(files.map(async (f) => {
        const header = await headObject(f.bucket, parseS3Uri(f.filename).Key);
        return { filename: f.filename, fileSize: header.ContentLength, LastModified: header.LastModified };
      }));

      // update one of the input files, so that the file has different checksum
      const content = randomString();
      const file = inputPayload.granules[0].files[0];
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

    it('does not overwrite existing file or create a copy of new file', async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
      const files = lambdaOutput.payload.granules[0].files;

      const currentFiles = await Promise.all(files.map(async (f) => {
        const header = await headObject(f.bucket, parseS3Uri(f.filename).Key);
        return { filename: f.filename, fileSize: header.ContentLength, LastModified: header.LastModified };
      }));

      expect(currentFiles).toEqual(existingfiles);
      expect(lambdaOutput.payload).toEqual(expectedPayload);
    });
  });
});
