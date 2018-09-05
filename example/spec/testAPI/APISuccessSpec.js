'use strict';

const fs = require('fs-extra');
const { loadConfig } = require('../helpers/testUtils');
const sleep = require('sleep-promise');
const {
  aws: { s3 }
} = require('@cumulus/common');
const { setupTestGranuleForIngest } = require('../helpers/granuleUtils');
const {
  buildAndExecuteWorkflow,
  conceptExists
} = require('@cumulus/integration-tests');
const { Search } = require('@cumulus/api/es/search');
const config = loadConfig();
const taskName = 'IngestGranule';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';
const { api: apiTestUtils } = require('@cumulus/integration-tests');

/**
 * Checks for granule in CMR until it get the desired outcome or hits
 * the number of retries.
 *
 * @param {string} CMRLink - url for grnaule in CMR
 * @param {string} outcome - desired outcome
 * @param {string} retries - number of remaining tries
 * @param {number} delay - time (in ms) to wait between tries
 * @returns {Promise<boolean>} - whether or not the granule exists
 */
async function waitForExist(CMRLink, outcome, retries, delay = 2000) {
  if (retries === 0) {
    console.log('Out of retries');
    return false;
  }

  const existsCheck = await conceptExists(CMRLink);
  if (existsCheck !== outcome) {
    await sleep(delay);
    console.log('Retrying ...');
    return waitForExist(CMRLink, outcome, (retries - 1));
  }

  return true;
}

describe('The Cumulus API', () => {
  let workflowExecution = null;
  let esClient;
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  const inputPayloadFilename = './spec/testAPI/testAPI.input.payload.json';
  let inputPayload;
  let granuleId;
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  process.env.UsersTable = `${config.stackName}-UsersTable`;

  beforeAll(async () => {
    const host = config.esHost;
    esClient = await Search.es(host);
    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, testDataGranuleId, granuleRegex);
    granuleId = inputPayload.granules[0].granuleId;

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

  describe('removeFromCMR & PublishGranule', () => {
    let granule;
    let cmrLink;

    it('removeFromCMR removes the ingested granule from CMR', async () => {
      granule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      cmrLink = granule.cmrLink;

      const existsInCMR = await conceptExists(cmrLink);
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

    it('applyWorkflow PublishGranule publishes the granule to CMR', async () => {
      const existsInCMR = await conceptExists(cmrLink);
      expect(existsInCMR).toEqual(false);

      // Publish the granule to CMR
      await apiTestUtils.applyWorkflow({
        prefix: config.stackName,
        granuleId,
        workflow: 'PublishGranule'
      });

      const granulePublished = await waitForExist(cmrLink, true, 6, 20000);
      expect(granulePublished).toEqual(true);

      // Cleanup: remove from CMR
      await apiTestUtils.removeFromCMR({
        prefix: config.stackName,
        granuleId
      });

      // Check that the granule was removed
      const granuleRemoved = await waitForExist(granule.cmrLink, false, 2);
      expect(granuleRemoved).toEqual(true);
    });
  });

  describe('executions endpoint', () => {
    it('returns tasks metadata with name and version', async () => {
      const executionResponse = await apiTestUtils.getExecution({
        prefix: config.stackName,
        arn: workflowExecution.executionArn
      });
      expect(executionResponse.tasks).toBeDefined();
      expect(executionResponse.tasks.length).not.toEqual(0);
      Object.keys(executionResponse.tasks).forEach((step) => {
        const task = executionResponse.tasks[step];
        expect(task.name).toBeDefined();
        expect(task.version).toBeDefined();
      });
    });
  });

  describe('logs endpoint', () => {
    it('returns the execution logs', async () => {
      const logs = await apiTestUtils.getLogs({ prefix: config.stackName });
      expect(logs).not.toBe(undefined);
      expect(logs.results.length).toEqual(10);
    });

    it('returns logs with taskName included', async () => {
      const logs = await apiTestUtils.getLogs({ prefix: config.stackName });
      logs.results.forEach((log) => {
        if ((!log.message.includes('END')) && (!log.message.includes('REPORT')) && (!log.message.includes('START'))) {
          expect(log.sender).not.toBe(undefined);
        }
      });
    });

    it('returns logs with a specific execution name', async () => {
      const executionARNTokens = workflowExecution.executionArn.split(':');
      const executionName = executionARNTokens[executionARNTokens.length - 1];
      const logs = await apiTestUtils.getExecutionLogs({ prefix: config.stackName, executionName: executionName });
      expect(logs.meta.count).not.toEqual(0);
      logs.results.forEach((log) => {
        expect(log.sender).not.toBe(undefined);
        expect(log.executions).toEqual(executionName);
      });
    });
  });
});
