'use strict';

const fs = require('fs-extra');
const { loadConfig } = require('../helpers/testUtils');
const {
  aws: { s3 },
  stringUtils: { globalReplace },
  testUtils: { randomStringFromRegex }
} = require('@cumulus/common');
const {
  models: { Execution, Granule }
} = require('@cumulus/api');
const {
  createGranuleFiles
} = require('../helpers/granuleUtils');
const {
  buildAndExecuteWorkflow
} = require('@cumulus/integration-tests');
const config = loadConfig();
const taskName = 'IngestGranule';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006.[\\d]{13}$';
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';
const { api: apiTestUtils } = require('@cumulus/integration-tests');

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
async function setupTestGranuleForAPI(bucket, granuleId, inputPayloadJson) {
  const baseInputPayload = JSON.parse(inputPayloadJson);

  await createGranuleFiles(
    baseInputPayload.granules[0].files,
    bucket,
    testDataGranuleId,
    granuleId
  );

  const updatedInputPayloadJson = globalReplace(inputPayloadJson, testDataGranuleId, granuleId);
  // console.log(updatedInputPayloadJson);

  return JSON.parse(updatedInputPayloadJson);
}

describe('The Cumulus API', () => {
  let workflowExecution = null;
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  const inputPayloadFilename = './spec/testAPI/testAPI.input.payload.json';
  let inputPayload;
  let granuleId;
  const granuleModel = new Granule();

  beforeAll(async () => {
    console.log('Starting API test');
    granuleId = randomStringFromRegex(granuleRegex);

    console.log(`granule id: ${granuleId}`);
    // console.log(config);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    inputPayload = await setupTestGranuleForAPI(config.bucket, granuleId, inputPayloadJson);

    // delete the granule record from DynamoDB if exists
    // await granuleModel.delete({ granuleId: inputPayload.granules[0].granuleId });

    console.log('SOMETHING GOES HERE :', inputPayload);

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    // await s3().deleteObject({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${executionName}.output` }).promise();

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

  describe('reingest a granule', () => {
    // const granuleId = inputPayload.granules[0].granuleId;
    it('executes with success status', async () => {
      const response = await apiTestUtils.reingestGranule({
        prefix: config.stackName,
        granuleId
      });
      expect(response.status).toEqual('SUCCESS');
    });
  });
});

