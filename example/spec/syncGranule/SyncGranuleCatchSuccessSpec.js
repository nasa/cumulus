const fs = require('fs');
const { Collection } = require('@cumulus/api/models');
const { buildAndExecuteWorkflow } = require('@cumulus/integration-tests');

const { loadConfig } = require('../helpers/testUtils');
const config = loadConfig();
const taskName = 'SyncGranuleCatchWorkflow';

describe('The SyncGranuleCatchWorkflow workflow', () => {
  const inputPayloadFilename = './spec/syncGranule/SyncGranule.input.payload.json';
  const inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename));
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };

  beforeAll(async () => {
    // eslint-disable-next-line function-paren-newline
    await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload
    );
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

    it('completes execution with success status', async () => {
      expect(secondWorkflowExecution.status).toEqual('SUCCEEDED');
    });

    afterAll(async () => {
      await c.update(collection, { duplicateHandling: 'replace' });
    });
  });
});
