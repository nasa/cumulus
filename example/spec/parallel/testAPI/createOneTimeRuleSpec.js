'use strict';

const get = require('lodash/get');
const pick = require('lodash/pick');
const pWaitFor = require('p-wait-for');

const { randomId } = require('@cumulus/common/test-utils');
const { deleteRule } = require('@cumulus/api-client/rules');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const rulesApi = require('@cumulus/api-client/rules');
const {
  isWorkflowTriggeredByRule,
  waitForTestExecutionStart,
} = require('@cumulus/integration-tests');
const { findExecutionArn } = require('@cumulus/integration-tests/Executions');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');

const {
  loadConfig,
  timestampedName,
} = require('../../helpers/testUtils');

let ingestTime;

describe('Creating a one-time rule via the Cumulus API', () => {
  let beforeAllFailed = false;
  let collection;
  let config;
  let executionArn;
  let prefix;
  let rule;
  let testExecutionId;
  let executionArn2;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;

      collection = await createCollection(prefix);

      testExecutionId = randomId('test-execution-');

      ingestTime = Date.now() - 1000 * 30;

      console.log(`Creating rule for HelloWorldWorkflow with testExecutionId ${testExecutionId}`);

      const oneTimeRuleName = timestampedName('OneTimeExecutionNamePrefix');
      console.log('created one time rule with name: %s', oneTimeRuleName);
      rule = await createOneTimeRule(
        prefix,
        {
          name: oneTimeRuleName,
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

    await deleteExecution({ prefix: config.stackName, executionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: executionArn2 });

    if (collection) {
      await deleteCollection({
        prefix,
        collectionName: collection.name,
        collectionVersion: collection.version,
      });
    }
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

  it('the rule can be updated', async () => {
    const updatedCheck = timestampedName('Updated');

    const updatingRuleResponse = await rulesApi.updateRule({
      prefix: config.stackName,
      ruleName: rule.name,
      updateParams: {
        // ...postRule.record,
        meta: {
          triggerRule: updatedCheck,
        },
      },
    });

    const updatedRule = JSON.parse(updatingRuleResponse.body);

    await rulesApi.rerunRule({
      prefix: config.stackName,
      ruleName: rule.name,
      updateParams: { ...updatedRule },
    });

    console.log(`Waiting for new execution of ${rule.workflow} triggered by rerun of rule`);
    const updatedExecution = await waitForTestExecutionStart({
      workflowName: rule.workflow,
      stackName: config.stackName,
      bucket: config.bucket,
      findExecutionFn: isWorkflowTriggeredByRule,
      findExecutionFnParams: { rule: updatedCheck },
      startTask: 'HelloWorld',
    });

    executionArn2 = updatedExecution.executionArn;

    const lambdaStep = new LambdaStep();
    const updatedTaskInput = await lambdaStep.getStepInput(updatedExecution.executionArn, 'HelloWorld');
    expect(updatedExecution).not.toBeNull();
    expect(updatedTaskInput.meta.triggerRule).toEqual(updatedCheck);
  });

  it('the rule is returned with the listed rules', async () => {
    await expectAsync(
      pWaitFor(
        async () => {
          const listRulesResponse = await rulesApi.listRules({
            prefix,
            query: {
              name: rule.name,
            },
          });
          const responseBody = JSON.parse(listRulesResponse.body);

          return responseBody.meta.count > 0;
        },
        {
          interval: 1000,
          timeout: 60 * 1000,
        }
      )
    ).toBeResolved();
  });
});
