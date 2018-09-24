'use strict';

const fs = require('fs-extra');
const {
  stringUtils: { globalReplace }
} = require('@cumulus/common');
const {
  api: { apiTestUtils },
  buildAndExecuteWorkflow,
  conceptExists,
  waitForConceptExistsOutcome
} = require('@cumulus/integration-tests');
const {
  loadConfig,
  timestampedTestDataPrefix,
  uploadTestDataToBucket,
  deleteFolder
} = require('../helpers/testUtils');
const { setupTestGranuleForIngest } = require('../helpers/granuleUtils');
const config = loadConfig();
const taskName = 'IngestGranule';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

describe('The Cumulus API', () => {
  const testDataFolder = timestampedTestDataPrefix(`${config.stackName}-APISuccess`);
  let workflowExecution = null;
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  const inputPayloadFilename = './spec/testAPI/testAPI.input.payload.json';
  let inputPayload;
  let inputGranuleId;
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  process.env.UsersTable = `${config.stackName}-UsersTable`;

  beforeAll(async () => {
    // Upload test data
    await uploadTestDataToBucket(config.bucket, s3data, testDataFolder, true);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // Update input file paths
    const updatedInputPayloadJson = globalReplace(inputPayloadJson, 'cumulus-test-data/pdrs', testDataFolder);
    inputPayload = await setupTestGranuleForIngest(config.bucket, updatedInputPayloadJson, testDataGranuleId, granuleRegex);
    inputGranuleId = inputPayload.granules[0].granuleId;

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

  describe('granule endpoint', () => {
    let granule;
    let cmrLink;

    beforeAll(async () => {
      granule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputGranuleId
      });
      cmrLink = granule.cmrLink;
    });

    it('makes the granule available through the Cumulus API', async () => {
      expect(granule.granuleId).toEqual(inputGranuleId);
    });

    it('has the granule with a CMR link', () => {
      expect(granule.cmrLink).not.toBeUndefined();
    });

    it('removeFromCMR removes the ingested granule from CMR', async () => {
      const existsInCMR = await conceptExists(cmrLink);

      expect(existsInCMR).toEqual(true);

      // Remove the granule from CMR
      await apiTestUtils.removeFromCMR({
        prefix: config.stackName,
        granuleId: inputGranuleId
      });

      // Check that the granule was removed
      await waitForConceptExistsOutcome(cmrLink, false, 2);
      const doesExist = await conceptExists(cmrLink);
      expect(doesExist).toEqual(false);
    });

    it('applyWorkflow PublishGranule publishes the granule to CMR', async () => {
      const existsInCMR = await conceptExists(cmrLink);
      expect(existsInCMR).toEqual(false);

      // Publish the granule to CMR
      await apiTestUtils.applyWorkflow({
        prefix: config.stackName,
        granuleId: inputGranuleId,
        workflow: 'PublishGranule'
      });

      await waitForConceptExistsOutcome(cmrLink, true, 10, 30000);
      const doesExist = await conceptExists(cmrLink);
      expect(doesExist).toEqual(true);
    });

    it('allows reingest and executes with success status', async () => {
      const initialUpdatedAt = (await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputGranuleId
      })).updatedAt;

      // Reingest Granule and compare the updatedAt times
      const response = await apiTestUtils.reingestGranule({
        prefix: config.stackName,
        granuleId: inputGranuleId
      });
      expect(response.status).toEqual('SUCCESS');

      const newUpdatedAt = (await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputGranuleId
      })).updatedAt;
      expect(newUpdatedAt).not.toEqual(initialUpdatedAt);
    });
  });

  describe('deleteGranule', () => {
    it('deletes the ingested granule from the API', async () => {
      const granule = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });

      // Delete the granule
      await apiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: granule.granuleId
      });

      // Verify deletion
      const resp = await apiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: granule.granuleId
      });
      expect(resp.message).toEqual('Granule not found');
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
