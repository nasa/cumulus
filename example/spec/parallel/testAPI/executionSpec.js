'use strict';

const { deleteCollection } = require('@cumulus/api-client/collections');
const {
  createExecution,
  deleteExecution,
  getExecution,
  updateExecution,
} = require('@cumulus/api-client/executions');
const { randomId } = require('@cumulus/common/test-utils');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { buildRandomizedExecution } = require('@cumulus/integration-tests/Executions');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { loadConfig } = require('../../helpers/testUtils');

describe('The Executions API', () => {
  let beforeAllFailed = false;
  let config;
  let collection;
  let collectionId;
  let executionArn;
  let prefix;
  let randomExecutionRecord;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;

      collection = await createCollection(prefix);
      collectionId = constructCollectionId(collection.name, collection.version);

      randomExecutionRecord = buildRandomizedExecution({
        collectionId,
        status: 'running',
      });
      executionArn = randomExecutionRecord.arn;
    } catch (error) {
      beforeAllFailed = true;
      console.log(error);
    }
  });

  afterAll(async () => {
    await deleteExecution({ prefix, executionArn });
    await deleteCollection({
      prefix,
      collectionName: collection.name,
      collectionVersion: collection.version,
    });
  });

  describe('the Execution Api', () => {
    it('creates an execution.', async () => {
      if (beforeAllFailed) {
        fail('beforeAll() failed');
      } else {
        const response = await createExecution({
          prefix,
          body: randomExecutionRecord,
        });

        expect(response.statusCode).toBe(200);
        const { message, record } = JSON.parse(response.body);
        expect(message).toBe('Record saved');
        expect(record).toEqual(jasmine.objectContaining(randomExecutionRecord));
      }
    });

    it('can discover the execution in the API.', async () => {
      const execution = await getExecution({
        prefix,
        arn: executionArn,
      });
      expect(execution).toEqual(jasmine.objectContaining(randomExecutionRecord));
    });

    it('can update the execution in the API.', async () => {
      const updatedExecutionRecord = {
        ...randomExecutionRecord,
        status: 'completed',
      };
      const response = await updateExecution({
        prefix,
        body: updatedExecutionRecord,
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result).toEqual(jasmine.objectContaining(updatedExecutionRecord));
    });

    it('Errors creating a bad execution.', async () => {
      const name = randomId('name');
      const version = randomId('version');
      const badRandomExecutionRecord = buildRandomizedExecution({
        collectionId: constructCollectionId(name, version),
      });
      try {
        await createExecution({
          prefix,
          body: badRandomExecutionRecord,
        });
      } catch (error) {
        const apiError = JSON.parse(error.apiMessage);
        expect(apiError.statusCode).toBe(400);
        expect(apiError.error).toBe('Bad Request');
        expect(apiError.message).toContain('does not exist');
        expect(apiError.message).toContain(name);
        expect(apiError.message).toContain(version);
      }
    });
  });
});
