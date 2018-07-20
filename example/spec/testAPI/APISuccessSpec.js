'use strict';

const fs = require('fs-extra');
const { loadConfig } = require('../helpers/testUtils');
const sleep = require('sleep-promise');
const {
  aws: { s3 },
  stringUtils: { globalReplace },
  testUtils: { randomStringFromRegex }
} = require('@cumulus/common');
const { createGranuleFiles } = require('../helpers/granuleUtils');
const {
  buildAndExecuteWorkflow,
  conceptExists
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

  return JSON.parse(updatedInputPayloadJson);
}

/**
 * Checks for granule in CMR until it get the desired outcome or hits
 * the number of retries.
 *
 * @param {string} CMRLink - url for grnaule in CMR
 * @param {string} outcome - desired outcome
 * @param {string} retries - number of remaining tries
 * @returns {Promise<boolean>} - whether or not the granule exists
 */
async function waitForExist(CMRLink, outcome, retries) {
  if (retries === 0) {
    console.log('Out of retries');
    return false;
  }

  const existsCheck = await conceptExists(CMRLink);
  if (existsCheck !== outcome) {
    await sleep(2000);
    console.log('Retrying ...');
    return waitForExist(CMRLink, outcome, (retries - 1));
  }

  return true;
}

describe('The Cumulus API', () => {
  let workflowExecution = null;
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  const inputPayloadFilename = './spec/testAPI/testAPI.input.payload.json';
  let inputPayload;
  let granuleId;
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  process.env.UsersTable = `${config.stackName}-UsersTable`;

  beforeAll(async () => {
    granuleId = randomStringFromRegex(granuleRegex);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    inputPayload = await setupTestGranuleForAPI(config.bucket, granuleId, inputPayloadJson);

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
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
    it('executes with success status', async () => {
      const response = await apiTestUtils.reingestGranule({
        prefix: config.stackName,
        granuleId
      });
      expect(response.status).toEqual('SUCCESS');
    });

    it('uses reingest', async () => {
      const granule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });

      // Reingest Granule and compare the updatedAt times
      await apiTestUtils.reingestGranule({
        prefix: config.stackName,
        granuleId
      });
      await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      expect(granule.updatedAt).not.toEqual(true);
    });

    it('in place with applyWorkflow', async () => {
      const granule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });

      await apiTestUtils.applyWorkflow({
        prefix: config.stackName,
        granuleId,
        workflow: 'IngestGranule'
      });

      const recentGranule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      expect(granule.updatedAt).not.toEqual(recentGranule.updatedAt);
    });
  });

  describe('removeFromCMR', () => {
    it('removes the ingested granule from CMR', async () => {
      const granule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      const existsInCMR = await conceptExists(granule.cmrLink);
      expect(existsInCMR).toEqual(true);

      // Remove the granule from CMR
      await apiTestUtils.removeFromCMR({
        prefix: config.stackName,
        granuleId
      });

      // Check that the granule was removed
      const granuleRemoved = await waitForExist(granule.cmrLink, false, 2);
      expect(granuleRemoved).toEqual(true);
    });
  });
});

