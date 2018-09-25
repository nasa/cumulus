const fs = require('fs');
const { Collection } = require('@cumulus/api/models');
const { addCollections, buildAndExecuteWorkflow } = require('@cumulus/integration-tests');

const { loadConfig } = require('../helpers/testUtils');
const config = loadConfig();

describe('The Sync Granules workflow is configured to handle duplicates as an error', () => {
  const inputPayloadFilename = './spec/syncGranule/SyncGranule.input.payload.json';
  const inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename));
  const collection = { name: 'MOD09GQ_duplicateHandlingError', version: '006' };
  const provider = { id: 's3_provider' };

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const c = new Collection();

  beforeAll(async () => {
    const collectionsDirectory = './data/collections/syncGranule';
    await addCollections(config.stackName, config.bucket, collectionsDirectory);
  });

  it('configured collection to handle duplicates as error', () => {
    const collectionInfo = c.get(collection);
    expect(collectionInfo.duplicateHandling, 'error');
  });

  describe('and it is configured to catch the duplicate error', () => {
    let catchWorkflowExecution;
    const catchTaskName = 'SyncGranuleCatchDuplicateErrorTest';

    beforeAll(async () => {
      catchWorkflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, catchTaskName, collection, provider, inputPayload
      );
    });

    it('completes execution with success status', () => {
      expect(catchWorkflowExecution.status).toEqual('SUCCEEDED');
    });
  });

  describe('and it is not configured to catch the duplicate error', () => {
    const taskName = 'SyncGranule';
    let failWorkflowExecution;

    beforeAll(async () => {
      failWorkflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, taskName, collection, provider, inputPayload
      );
    });

    it('fails the workflow', () => {
      expect(failWorkflowExecution.status).toEqual('FAILED');
    });
  });

  afterAll(async () => {
    await c.delete(collection);
  });
});
