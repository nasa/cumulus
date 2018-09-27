const fs = require('fs');
const path = require('path');
const { Execution } = require('@cumulus/api/models');
const {
  aws: { s3, s3ObjectExists },
  stringUtils: { globalReplace }
} = require('@cumulus/common');
const {
  buildAndExecuteWorkflow,
  addProviders,
  cleanupProviders,
  addCollections,
  cleanupCollections,
  LambdaStep
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  templateFile,
  uploadTestDataToBucket,
  timestampedTestPrefix,
  timestampedTestDataPrefix,
  deleteFolder
} = require('../helpers/testUtils');
const { setupTestGranuleForIngest, loadFileWithUpdatedGranuleIdAndPath } = require('../helpers/granuleUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const taskName = 'SyncGranule';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';
const defaultDataFolder = 'cumulus-test-data/pdrs';

const outputPayloadTemplateFilename = './spec/syncGranule/SyncGranule.output.payload.template.json'; // eslint-disable-line max-len
const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: outputPayloadTemplateFilename,
  config: config.SyncGranule
});

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf'
];

describe('The Sync Granules workflow', () => {
  const testPostfix = timestampedTestPrefix(`_${config.stackName}-SyncGranuleSuccess`);
  const testDataFolder = timestampedTestDataPrefix(`${config.stackName}-SyncGranuleSuccess`);
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testPostfix}`, version: '006' };
  const provider = { id: `s3_provider${testPostfix}` };
  const inputPayloadFilename = './spec/syncGranule/SyncGranule.input.payload.json';
  let inputPayload;
  let expectedPayload;
  let workflowExecution = null;

  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  const executionModel = new Execution();

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      await uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      await addCollections(config.stackName, config.bucket, collectionsDir, testPostfix),
      await addProviders(config.stackName, config.bucket, providersDir, config.bucket, testPostfix)
    ]);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    const updatedInputPayloadJson = globalReplace(inputPayloadJson, defaultDataFolder, testDataFolder);
    inputPayload = setupTestGranuleForIngest(config.bucket, updatedInputPayloadJson, testDataGranuleId, granuleRegex);
    inputPayload.granules[0].dataType += testPostfix;
    const newGranuleId = inputPayload.granules[0].granuleId;

    expectedPayload = loadFileWithUpdatedGranuleIdAndPath(templatedOutputPayloadFilename, testDataGranuleId, newGranuleId, defaultDataFolder, testDataFolder);
    expectedPayload.granules[0].dataType += testPostfix;

    // eslint-disable-next-line function-paren-newline
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      await deleteFolder(config.bucket, testDataFolder),
      await cleanupCollections(config.stackName, config.bucket, collectionsDir, testPostfix),
      await cleanupProviders(config.stackName, config.bucket, providersDir, testPostfix)
    ]);
  });

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the SyncGranule Lambda function', () => {
    let lambdaOutput = null;
    let files;
    let key1;
    let key2;
    const existCheck = [];

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
      files = lambdaOutput.payload.granules[0].files;
      key1 = path.join(files[0].fileStagingDir, files[0].name);
      key2 = path.join(files[1].fileStagingDir, files[1].name);
      existCheck[0] = await s3ObjectExists({ Bucket: files[0].bucket, Key: key1 });
      existCheck[1] = await s3ObjectExists({ Bucket: files[1].bucket, Key: key2 });
    });

    afterAll(async () => {
      await s3().deleteObject({ Bucket: files[0].bucket, Key: key1 }).promise();
      await s3().deleteObject({ Bucket: files[1].bucket, Key: key2 }).promise();
    });

    it('receives payload with file objects updated to include file staging location', () => {
      expect(lambdaOutput.payload).toEqual(expectedPayload);
    });

    // eslint-disable-next-line max-len
    it('receives meta.input_granules with files objects updated to include file staging location', () => {
      expect(lambdaOutput.meta.input_granules).toEqual(expectedPayload.granules);
    });

    it('receives files with custom staging directory', () => {
      files.forEach((file) => {
        expect(file.fileStagingDir).toMatch('custom-staging-dir\/.*');
      });
    });

    it('adds files to staging location', () => {
      existCheck.forEach((check) => {
        expect(check).toEqual(true);
      });
    });
  });

  describe('the sf-sns-report task has published a sns message and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await executionModel.get({ arn: workflowExecution.executionArn });
      expect(record.status).toEqual('completed');
    });
  });
});
