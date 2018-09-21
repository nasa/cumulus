const fs = require('fs');
const path = require('path');
const {
  aws: { s3, s3ObjectExists },
  stringUtils: { globalReplace }
} = require('@cumulus/common');
const { Collection, Execution } = require('@cumulus/api/models');
const { buildAndExecuteWorkflow, LambdaStep } = require('@cumulus/integration-tests');

const {
  loadConfig,
  templateFile,
  uploadTestDataToBucket,
  timestampedTestDataPrefix,
  deleteFolder
} = require('../helpers/testUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const taskName = 'SyncGranule';

const outputPayloadTemplateFilename = './spec/syncGranule/SyncGranule.output.payload.template.json'; // eslint-disable-line max-len
const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: outputPayloadTemplateFilename,
  config: config.SyncGranule
});

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

describe('The Sync Granules workflow', () => {
  const testDataFolder = timestampedTestDataPrefix(`${config.stackName}-SyncGranuleSuccess`);
  const inputPayloadFilename = './spec/syncGranule/SyncGranule.input.payload.json';
  let inputPayload;
  let expectedPayload;
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  let workflowExecution = null;

  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  const executionModel = new Execution();

  beforeAll(async () => {
    // upload test data
    await uploadTestDataToBucket(config.bucket, s3data, testDataFolder, true);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    const updatedInputPayloadJson = globalReplace(inputPayloadJson, 'cumulus-test-data/pdrs', testDataFolder);
    inputPayload = JSON.parse(updatedInputPayloadJson);

    const expectedPayloadJson = fs.readFileSync(templatedOutputPayloadFilename, 'utf8');
    const updatedExpectedPayloadJson = globalReplace(expectedPayloadJson, 'cumulus-test-data/pdrs', testDataFolder);
    expectedPayload = JSON.parse(updatedExpectedPayloadJson);

    // eslint-disable-next-line function-paren-newline
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    // Remove the granule files added for the test
    await deleteFolder(config.bucket, testDataFolder);
  });

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('when configured to handle duplicates as error', () => {
    let secondWorkflowExecution;
    let collectionInfo;

    process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
    const c = new Collection();

    beforeAll(async () => {
      collectionInfo = await c
        .update(collection, { duplicateHandling: 'error' })
        .then(() => c.get(collection));
      secondWorkflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, taskName, collection, provider, inputPayload
      );
    });

    it('configured collection to handle duplicates as error', () => {
      expect(collectionInfo.duplicateHandling, 'error');
    });

    it('fails the workflow', () => {
      expect(secondWorkflowExecution.status).toEqual('FAILED');
    });

    afterAll(async () => {
      await c.update(collection, { duplicateHandling: 'replace' });
    });
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

  describe('when configured to handle duplicates as error', () => {
    let secondExecution;
    let collectionInfo;

    beforeAll(async () => {
      const c = new Collection();
      collectionInfo = await c
        .get({ name: collection.name, version: collection.version })
        .then(() => c.update(collection, { duplicateHandling: 'error' }))
        .then(() => c.get(collection));
      secondExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, taskName, collection, provider, inputPayload
      );
    });

    it('configured collection properly', () => {
      expect(collectionInfo.duplicateHandling, 'error');
    });

    it('fails the workflow', () => {
      expect(secondExecution.status).toEqual('FAILED');
    });

    afterAll(async () => {
      const c = new Collection();
      await c.update(collection, { duplicateHandling: 'replace' })
        .then(() => c.get(collection));
    });
  });

  describe('the sf-sns-report task has published a sns message and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await executionModel.get({ arn: workflowExecution.executionArn });
      expect(record.status).toEqual('completed');
    });
  });
});
