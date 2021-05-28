'use strict';

const get = require('lodash/get');
const pick = require('lodash/pick');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');
const { randomId } = require('@cumulus/common/test-utils');
const { deleteRule } = require('@cumulus/api-client/rules');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { findExecutionArn } = require('@cumulus/integration-tests/Executions');

const { loadConfig } = require('../../helpers/testUtils');

let ingestTime;

describe('Creating a one-time rule via the Cumulus API', () => {
  let beforeAllFailed = false;
  let collection;
  let config;
  let executionArn;
  let prefix;
  let rule;
  let testExecutionId;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;

      collection = await createCollection(prefix);

      testExecutionId = randomId('test-execution-');

      ingestTime = Date.now() - 1000 * 30;

      console.log(`Creating rule for HelloWorldWorkflow with testExecutionId ${testExecutionId}`);

      rule = await createOneTimeRule(
        prefix,
        {
          workflow: 'HelloWorldWorkflow',
          collection: pick(collection, ['name', 'version']),
          payload: { testExecutionId },
        }
      );
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    const ruleName = get(rule, 'name');

    if (ruleName) await deleteRule({ prefix, ruleName });

    const x = await deleteExecution({ prefix: config.stackName, executionArn });

    let y;
    if (collection) {
      y = await deleteCollection({
        prefix,
        collectionName: collection.name,
        collectionVersion: collection.version,
      });
    }

    console.log('afterAll - createOneTimeRuleSpec:::', x, y);
  });

  it('starts a workflow execution', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      executionArn = await findExecutionArn(
        prefix,
        (execution) =>
          get(execution, 'originalPayload.testExecutionId') === testExecutionId,
        { timestamp__from: ingestTime },
        { timeout: 60 }
      );
      expect(executionArn).toContain('arn:aws');
    }
  });
});
