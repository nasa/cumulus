const fs = require('fs');
const path = require('path');
const { Collection } = require('@cumulus/api/models');
const { constructCollectionId } = require('@cumulus/common');
const { addCollections, buildAndExecuteWorkflow, LambdaStep } = require('@cumulus/integration-tests');

const { loadConfig } = require('../helpers/testUtils');
const config = loadConfig();

const lambdaStep = new LambdaStep();

describe('The Sync Granules workflow is configured to handle duplicates as an error', () => {
  const inputPayloadFilename = './spec/syncGranule/SyncGranule.input.payload.json';
  const inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename));
  const collection = { name: 'MOD09GQ_duplicateHandlingError', version: '006' };
  const provider = { id: 's3_provider' };

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const c = new Collection();

  const catchTaskName = 'SyncGranuleCatchDuplicateErrorTest';
  const taskName = 'SyncGranule';

  const granuleFileName = inputPayload.granules[0].files[0].name;
  let existingFileKey;

  beforeAll(async () => {
    const collectionsDirectory = './data/collections/syncGranule';
    await addCollections(config.stackName, config.bucket, collectionsDirectory);
    await buildAndExecuteWorkflow(
      config.stackName, config.bucket, catchTaskName, collection, provider, inputPayload
    );
    await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload
    );
    const collectionInfo = await c.get(collection);
    existingFileKey = path.join(
      'custom-staging-dir',
      config.stackName,
      constructCollectionId(collectionInfo.dataType, collectionInfo.version),
      granuleFileName
    );
  });

  it('configured collection to handle duplicates as error', () => {
    const collectionInfo = c.get(collection);
    expect(collectionInfo.duplicateHandling, 'error');
  });

  describe('and it is configured to catch the duplicate error', () => {
    let catchWorkflowExecution;

    beforeAll(async () => {
      catchWorkflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, catchTaskName, collection, provider, inputPayload
      );
    });

    it('fails the SyncGranule Lambda function', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(catchWorkflowExecution.executionArn, 'SyncGranuleNoVpc', 'failure');
      const { error, cause } = lambdaOutput;
      const errorCause = JSON.parse(cause);
      expect(error).toEqual('DuplicateFile');
      expect(errorCause.errorMessage).toEqual(
        `${existingFileKey} already exists in ${config.bucket} bucket`
      );
    });

    it('completes execution with success status', async () => {
      expect(catchWorkflowExecution.status).toEqual('SUCCEEDED');
    });
  });

  describe('and it is not configured to catch the duplicate error', () => {
    let failWorkflowExecution;

    beforeAll(async () => {
      failWorkflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, taskName, collection, provider, inputPayload
      );
    });

    it('fails the SyncGranule Lambda function', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(failWorkflowExecution.executionArn, 'SyncGranuleNoVpc', 'failure');
      const { error, cause } = lambdaOutput;
      const errorCause = JSON.parse(cause);
      expect(error).toEqual('DuplicateFile');
      expect(errorCause.errorMessage).toEqual(
        `${existingFileKey} already exists in ${config.bucket} bucket`
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
