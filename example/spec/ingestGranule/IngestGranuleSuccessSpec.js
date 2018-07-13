'use strict';

const fs = require('fs-extra');
const urljoin = require('url-join');
const got = require('got');
const cloneDeep = require('lodash.clonedeep');
const {
  models: { Execution, Granule }
} = require('@cumulus/api');
const {
  aws: { s3, s3ObjectExists },
  stringUtils: { globalReplace },
  testUtils: { randomStringFromRegex }
} = require('@cumulus/common');
const {
  buildAndExecuteWorkflow,
  LambdaStep,
  conceptExists,
  getOnlineResources
} = require('@cumulus/integration-tests');
const { api: apiTestUtils } = require('@cumulus/integration-tests');

const { loadConfig, templateFile, getExecutionUrl } = require('../helpers/testUtils');
const {
  createGranuleFiles,
  loadFileWithUpdatedGranuleId
} = require('../helpers/granuleUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const taskName = 'IngestGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006.[\\d]{13}$';
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';

const templatedSyncGranuleFilename = templateFile({
  inputTemplateFilename: './spec/ingestGranule/SyncGranule.output.payload.template.json',
  config: config[taskName].SyncGranuleOutput
});

const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: './spec/ingestGranule/IngestGranule.output.payload.template.json',
  config: config[taskName].IngestGranuleOutput
});

/**
 * Set up files in the S3 data location for a new granule to use for this
 * test. Use the input payload to determine which files are needed and
 * return updated input with the new granule id.
 *
 * @param {string} bucket - data bucket
 * @param {string} granuleId - granule id for the new files
 * @param {string} inputPayloadJson - input payload as a JSON string
 * @returns {Promise<Object>} - input payload as a JS object with the updated granule ids
 */
async function setupTestGranuleForIngest(bucket, granuleId, inputPayloadJson) {
  const baseInputPayload = JSON.parse(inputPayloadJson);

  await createGranuleFiles(
    baseInputPayload.granules[0].files,
    bucket,
    testDataGranuleId,
    granuleId
  );

  const updatedInputPayloadJson = globalReplace(inputPayloadJson, testDataGranuleId, granuleId);

  return JSON.parse(updatedInputPayloadJson);
}

describe('The S3 Ingest Granules workflow', () => {
  const inputPayloadFilename = './spec/ingestGranule/IngestGranule.input.payload.json';
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  let workflowExecution = null;
  let failingWorkflowExecution = null;
  let failedExecutionArn;
  let failedExecutionName;
  let inputPayload;
  let expectedSyncGranulePayload;
  let expectedPayload;

  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  const granuleModel = new Granule();
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  const executionModel = new Execution();
  let executionName;

  beforeAll(async () => {
    console.log('Starting ingest test');
    const granuleId = randomStringFromRegex(granuleRegex);

    console.log(`granule id: ${granuleId}`);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    inputPayload = await setupTestGranuleForIngest(config.bucket, granuleId, inputPayloadJson);

    expectedSyncGranulePayload = loadFileWithUpdatedGranuleId(templatedSyncGranuleFilename, testDataGranuleId, granuleId);

    expectedPayload = loadFileWithUpdatedGranuleId(templatedOutputPayloadFilename, testDataGranuleId, granuleId);

    // delete the granule record from DynamoDB if exists
    await granuleModel.delete({ granuleId: inputPayload.granules[0].granuleId });

    // eslint-disable-next-line function-paren-newline
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload
    );

    failingWorkflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, {}
    );
    failedExecutionArn = failingWorkflowExecution.executionArn.split(':');
    failedExecutionName = failedExecutionArn.pop();
  });

  afterAll(async () => {
    await s3().deleteObject({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${executionName}.output` }).promise();
    await s3().deleteObject({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${failedExecutionName}.output` }).promise();

    // Remove the granule files added for the test
    await Promise.all(
      inputPayload.granules[0].files.map((file) =>
        s3().deleteObject({
          Bucket: config.bucket, Key: `${file.path}/${file.name}`
        }).promise())
    );
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
    let lambdaOutput = null;

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

    it('has a payload with correct buckets and filenames', () => {
      files.forEach((file) => {
        const expectedFile = expectedPayload.granules[0].files.find((f) => f.name === file.name);
        expect(file.filename).toEqual(expectedFile.filename);
        expect(file.bucket).toEqual(expectedFile.bucket);
      });
    });

    it('moves files to the bucket folder based on metadata', () => {
      existCheck.forEach((check) => {
        expect(check).toEqual(true);
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
      const distEndpoint = config.distributionEndpoint;
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
