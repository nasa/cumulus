'use strict';

const omit = require('lodash/omit');
const { deleteCollection } = require('@cumulus/api-client/collections');
const {
  createExecution,
  deleteExecution,
  getExecution,
  updateExecution,
} = require('@cumulus/api-client/executions');
const {
  deleteS3Object,
  waitForObjectToExist,
} = require('@cumulus/aws-client/S3');
const { fakeExecutionFactoryV2 } = require('@cumulus/api/lib/testUtils');
const { randomId } = require('@cumulus/common/test-utils');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { findExecutionArn } = require('@cumulus/integration-tests/Executions');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { loadConfig } = require('../../helpers/testUtils');

describe('The Executions API', () => {
  let beforeAllFailed = false;
  let config;
  let collection;
  let collectionId;
  let executionArn;
  let prefix;
  let executionRecord;
  let updatedExecutionRecord;
  let executionMessageKey;
  let updatedExecutionMessageKey;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;

      collection = await createCollection(prefix);
      collectionId = constructCollectionId(collection.name, collection.version);

      executionRecord = omit(fakeExecutionFactoryV2({
        collectionId,
        status: 'running',
      }), ['parentArn', 'createdAt', 'updatedAt']);

      updatedExecutionRecord = {
        ...executionRecord,
        status: 'completed',
      };
      executionArn = executionRecord.arn;
      executionMessageKey = `${config.stackName}/test-output/${executionRecord.name}-${executionRecord.status}.output`;
      updatedExecutionMessageKey = `${config.stackName}/test-output/${updatedExecutionRecord.name}-${updatedExecutionRecord.status}.output`;
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
    await deleteS3Object(
      config.bucket,
      executionMessageKey
    );
  });

  describe('the Execution Api', () => {
    it('creates an execution.', async () => {
      if (beforeAllFailed) {
        fail('beforeAll() failed');
      } else {
        const response = await createExecution({
          prefix,
          body: executionRecord,
        });

        expect(response.statusCode).toBe(200);
        const { message } = JSON.parse(response.body);
        expect(message).toBe(`Successfully wrote execution with arn ${executionArn}`);
      }
    });

    it('can get the execution in the API.', async () => {
      const execution = await getExecution({
        prefix,
        arn: executionArn,
      });
      expect(execution).toEqual(jasmine.objectContaining(executionRecord));
    });

    it('publishes an SNS message for the created execution', async () => {
      await expectAsync(waitForObjectToExist({
        bucket: config.bucket,
        key: executionMessageKey,
      })).toBeResolved();
    });

    it('can update the execution in the API.', async () => {
      const response = await updateExecution({
        prefix,
        body: updatedExecutionRecord,
      });

      expect(response.statusCode).toBe(200);
      const { message } = JSON.parse(response.body);
      expect(message).toBe(`Successfully updated execution with arn ${executionArn}`);
    });

    it('publishes an SNS message for the updated execution', async () => {
      await expectAsync(waitForObjectToExist({
        bucket: config.bucket,
        key: updatedExecutionMessageKey,
      })).toBeResolved();
    });

    it('can search the execution in the API.', async () => {
      const arn = await findExecutionArn(
        prefix,
        () => true,
        {
          arn: executionArn,
          status: updatedExecutionRecord.status,
        },
        { timeout: 30 }
      );
      expect(arn).toBe(executionArn);
    });

    it('Errors creating a bad execution.', async () => {
      const name = randomId('name');
      const version = randomId('version');
      const badRandomExecutionRecord = fakeExecutionFactoryV2({
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
