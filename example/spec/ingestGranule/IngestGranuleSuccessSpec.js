'use strict';

const fs = require('fs-extra');
const urljoin = require('url-join');
const got = require('got');
const cloneDeep = require('lodash.clonedeep');
const {
  models: {
    Execution, Granule, Collection, Provider
  }
} = require('@cumulus/api');
const {
  aws: { s3, s3ObjectExists },
  constructCollectionId,
  testUtils: { randomString }
} = require('@cumulus/common');
const {
  buildAndExecuteWorkflow,
  LambdaStep,
  conceptExists,
  getOnlineResources,
  api: apiTestUtils
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  templateFile,
  uploadTestDataToBucket,
  deleteFolder,
  getExecutionUrl,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  getFilesMetadata
} = require('../helpers/testUtils');
const {
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection
} = require('../helpers/granuleUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const workflowName = 'IngestGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const templatedSyncGranuleFilename = templateFile({
  inputTemplateFilename: './spec/ingestGranule/SyncGranule.output.payload.template.json',
  config: config[workflowName].SyncGranuleOutput
});

const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: './spec/ingestGranule/IngestGranule.output.payload.template.json',
  config: config[workflowName].IngestGranuleOutput
});

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

describe('The S3 Ingest Granules workflow', () => {
  const testId = createTimestampedTestId(config.stackName, 'IngestGranuleSuccess');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);
  const inputPayloadFilename = './spec/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const newCollectionId = constructCollectionId(collection.name, collection.version);
  const provider = { id: `s3_provider${testSuffix}` };
  let workflowExecution = null;
  let failingWorkflowExecution = null;
  let failedExecutionArn;
  let failedExecutionName;
  let inputPayload;
  let expectedSyncGranulePayload;
  let expectedPayload;
  let startTime;

  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  const granuleModel = new Granule();
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  const executionModel = new Execution();
  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const collectionModel = new Collection();
  process.env.ProvidersTable = `${config.stackName}-ProvidersTable`;
  const providerModel = new Provider();
  let executionName;

  beforeAll(async () => {
    const collectionJson = JSON.parse(fs.readFileSync(`${collectionsDir}/s3_MOD09GQ_006.json`, 'utf8'));
    const collectionData = Object.assign({}, collectionJson, {
      name: collection.name,
      dataType: collectionJson.dataType + testSuffix
    });

    const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/s3_provider.json`, 'utf8'));
    const providerData = Object.assign({}, providerJson, {
      id: provider.id,
      host: config.bucket
    });

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      apiTestUtils.addCollection({ prefix: config.stackName, collection: collectionData }),
      apiTestUtils.addProvider({ prefix: config.stackName, provider: providerData })
    ]);

    console.log('Starting ingest test');
    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
    const granuleId = inputPayload.granules[0].granuleId;

    expectedSyncGranulePayload = loadFileWithUpdatedGranuleIdPathAndCollection(templatedSyncGranuleFilename, granuleId, testDataFolder, newCollectionId);
    expectedSyncGranulePayload.granules[0].dataType += testSuffix;
    expectedPayload = loadFileWithUpdatedGranuleIdPathAndCollection(templatedOutputPayloadFilename, granuleId, testDataFolder, newCollectionId);
    expectedPayload.granules[0].dataType += testSuffix;

    // pre-stage destination files for MoveGranules
    const preStageFiles = expectedPayload.granules[0].files.map(async (file) => {
      const params = {
        Bucket: file.bucket,
        Key: file.filepath,
        Body: randomString()
      };
      await s3().putObject(params).promise();
    });
    await Promise.all(preStageFiles);
    startTime = new Date();

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      inputPayload
    );

    failingWorkflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      {}
    );
    failedExecutionArn = failingWorkflowExecution.executionArn.split(':');
    failedExecutionName = failedExecutionArn.pop();
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      collectionModel.delete(collection),
      providerModel.delete(provider),
      executionModel.delete({ arn: workflowExecution.executionArn }),
      executionModel.delete({ arn: failingWorkflowExecution.executionArn }),
      s3().deleteObject({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${executionName}.output` }).promise(),
      s3().deleteObject({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${failedExecutionName}.output` }).promise(),
      apiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      })
    ]);
  });

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  it('makes the granule available through the Cumulus API', async () => {
    const granule = await apiTestUtils.getGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId
    });

    expect(granule.granuleId).toEqual(inputPayload.granules[0].granuleId);
  });

  describe('the SyncGranules task', () => {
    let lambdaOutput;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
    });

    it('output includes the ingested granule with file staging location paths', () => {
      expect(lambdaOutput.payload).toEqual(expectedSyncGranulePayload);
    });

    it('updates the meta object with input_granules', () => {
      expect(lambdaOutput.meta.input_granules).toEqual(expectedSyncGranulePayload.granules);
    });
  });

  describe('the MoveGranules task', () => {
    let lambdaOutput;
    let files;
    const existCheck = [];

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      files = lambdaOutput.payload.granules[0].files;
      existCheck[0] = await s3ObjectExists({ Bucket: files[0].bucket, Key: files[0].filepath });
      existCheck[1] = await s3ObjectExists({ Bucket: files[1].bucket, Key: files[1].filepath });
      existCheck[2] = await s3ObjectExists({ Bucket: files[2].bucket, Key: files[2].filepath });
    });

    afterAll(async () => {
      await s3().deleteObject({ Bucket: files[0].bucket, Key: files[0].filepath }).promise();
      await s3().deleteObject({ Bucket: files[1].bucket, Key: files[1].filepath }).promise();
      await s3().deleteObject({ Bucket: files[3].bucket, Key: files[3].filepath }).promise();
    });

    it('has a payload with correct buckets and filenames and filesizes', () => {
      files.forEach((file) => {
        const expectedFile = expectedPayload.granules[0].files.find((f) => f.name === file.name);
        expect(file.filename).toEqual(expectedFile.filename);
        expect(file.bucket).toEqual(expectedFile.bucket);
        if (file.fileSize) {
          expect(file.fileSize).toEqual(expectedFile.fileSize);
        }
      });
    });

    it('moves files to the bucket folder based on metadata', () => {
      existCheck.forEach((check) => {
        expect(check).toEqual(true);
      });
    });

    describe('encounters duplicate filenames', () => {
      it('overwrites the existing file with the new data', async () => {
        const currentFiles = await getFilesMetadata(files);

        currentFiles.forEach((cf) => {
          expect(cf.LastModified).toBeGreaterThan(startTime);
        });
      });
    });
  });

  describe('the PostToCmr task', () => {
    let lambdaOutput;
    let cmrResource;
    let cmrLink;
    let response;
    let files;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
      if (lambdaOutput === null) throw new Error(`Failed to get the PostToCmr step's output for ${workflowExecution.executionArn}`);

      files = lambdaOutput.payload.granules[0].files;
      cmrLink = lambdaOutput.payload.granules[0].cmrLink;
      cmrResource = await getOnlineResources(cmrLink);
      response = await got(cmrResource[1].href);
    });

    afterAll(async () => {
      await s3().deleteObject({ Bucket: files[2].bucket, Key: files[2].filepath }).promise();
    });

    it('has expected payload', () => {
      const granule = lambdaOutput.payload.granules[0];
      expect(granule.published).toBe(true);
      expect(granule.cmrLink.startsWith('https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=')).toBe(true);

      // Set the expected cmrLink to the actual cmrLink, since it's going to
      // be different every time this is run.
      const updatedExpectedpayload = cloneDeep(expectedPayload);
      updatedExpectedpayload.granules[0].cmrLink = lambdaOutput.payload.granules[0].cmrLink;

      expect(lambdaOutput.payload).toEqual(updatedExpectedpayload);
    });

    it('publishes the granule metadata to CMR', () => {
      const granule = lambdaOutput.payload.granules[0];
      const result = conceptExists(granule.cmrLink);

      expect(granule.published).toEqual(true);
      expect(result).not.toEqual(false);
    });

    it('updates the CMR metadata online resources with the final metadata location', () => {
      const distEndpoint = config.DISTRIBUTION_ENDPOINT;
      const extension1 = urljoin(files[0].bucket, files[0].filepath);
      const filename = `https://${files[2].bucket}.s3.amazonaws.com/${files[2].filepath}`;

      expect(cmrResource[0].href).toEqual(urljoin(distEndpoint, extension1));
      expect(cmrResource[1].href).toEqual(filename);

      expect(response.statusCode).toEqual(200);
    });
  });

  describe('an SNS message', () => {
    let lambdaOutput;
    const existCheck = [];

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
      executionName = lambdaOutput.cumulus_meta.execution_name;
      existCheck[0] = await s3ObjectExists({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${executionName}.output` });
      existCheck[1] = await s3ObjectExists({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${failedExecutionName}.output` });
    });

    it('is published on a successful workflow completion', () => {
      expect(existCheck[0]).toEqual(true);
    });

    it('is published on workflow failure', () => {
      expect(existCheck[1]).toEqual(true);
    });

    it('triggers the granule record being added to DynamoDB', async () => {
      const record = await granuleModel.get({ granuleId: inputPayload.granules[0].granuleId });
      expect(record.execution).toEqual(getExecutionUrl(workflowExecution.executionArn));
    });

    it('triggers the execution record being added to DynamoDB', async () => {
      const record = await executionModel.get({ arn: workflowExecution.executionArn });
      expect(record.status).toEqual('completed');
    });
  });
});
