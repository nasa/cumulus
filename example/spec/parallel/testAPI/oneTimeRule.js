'use strict';

const cloneDeep = require('lodash.clonedeep');

const {
  rulesApi: rulesApiTestUtils,
  getExecutions,
  LambdaStep
} = require('@cumulus/integration-tests');
const { sleep } = require('@cumulus/common/util');

const {
  loadConfig,
  timestampedName
} = require('../../helpers/testUtils');

const config = loadConfig();

const lambdaStep = new LambdaStep();

const waitPeriodMs = 1000;

const maxWaitForStartedExecutionSecs = 60 * 5;

const ruleName = timestampedName('HelloWorldIntegrationTestRule');
const createdCheck = timestampedName('Created');
const updatedCheck = timestampedName('Updated');
const helloWorldRule = {
  name: ruleName,
  workflow: 'HelloWorldWorkflow',
  rule: {
    type: 'onetime'
  },
  meta: {
    triggerRule: createdCheck // used to detect that we're looking at the correct execution
  }
};

/**
 * Remove params added to the rule when it is saved into dynamo
 * and comes back from the db
 *
 * @param {Object} rule - dynamo rule object
 * @returns {Object} - updated rule object that can be compared to the original
 */
function removeRuleAddedParams(rule) {
  const ruleCopy = cloneDeep(rule);
  delete ruleCopy.state;
  delete ruleCopy.createdAt;
  delete ruleCopy.updatedAt;
  delete ruleCopy.timestamp;

  return ruleCopy;
}

/**
 * Wait for the execution kicked off by the rule to begin.
 * We check that the execution input has the rule name in meta.triggerRule
 * so that we know we are looking at the right execution of the workflow
 * and not one that could have been triggered by something else
 *
 * @param {string} executionMatch - string to match triggerRule
 * @returns {undefined} - none
 */
async function waitForTestExecution(executionMatch) {
  let timeWaitedSecs = 0;
  let workflowExecution;

  /* eslint-disable no-await-in-loop */
  while (timeWaitedSecs < maxWaitForStartedExecutionSecs && workflowExecution === undefined) {
    await sleep(waitPeriodMs);
    timeWaitedSecs += (waitPeriodMs / 1000);
    const executions = await getExecutions(helloWorldRule.workflow, config.stackName, config.bucket);

    for (let ctr = 0; ctr < executions.length; ctr += 1) {
      const execution = executions[ctr];
      const taskInput = await lambdaStep.getStepInput(execution.executionArn, 'SfSnsReport');
      if (taskInput && taskInput.meta.triggerRule && taskInput.meta.triggerRule === executionMatch) {
        workflowExecution = execution;
        break;
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  if (timeWaitedSecs < maxWaitForStartedExecutionSecs) return workflowExecution;
  throw new Error('Never found started workflow.');
}

describe('When I create a one-time rule via the Cumulus API', () => {
  let postRule = '';

  beforeAll(async () => {
    // Create a one-time rule
    const postRuleResponse = await rulesApiTestUtils.postRule({
      prefix: config.stackName,
      rule: helloWorldRule
    });
    postRule = JSON.parse(postRuleResponse.body);
  });

  afterAll(async () => {
    console.log(`deleting rule ${helloWorldRule.name}`);
    await rulesApiTestUtils.deleteRule({
      prefix: config.stackName,
      ruleName: helloWorldRule.name
    });
  });

  it('the rule is returned in the post response', () => {
    const responseCopy = removeRuleAddedParams(postRule.record);

    expect(responseCopy).toEqual(helloWorldRule);
  });

  it('the rule is enabled by default', () => {
    expect(postRule.record.state).toEqual('ENABLED');
  });

  describe('Upon rule creation', () => {
    let execution;

    beforeAll(async () => {
      console.log(`Waiting for execution of ${helloWorldRule.workflow} triggered by rule`);
      execution = await waitForTestExecution(createdCheck);
      console.log(`Execution ARN: ${execution.executionArn}`);
    });

    it('a workflow is triggered by the rule', () => {
      expect(execution).toBeDefined();
    });

    it('the rule can be updated', async () => {
      const updatingRuleResponse = await rulesApiTestUtils.updateRule({
        prefix: config.stackName,
        rule: helloWorldRule,
        updateParams: {
          meta: {
            triggerRule: updatedCheck
          }
        }
      });

      const updatedRule = JSON.parse(updatingRuleResponse.body);
      console.log('Updated Rule', updatedRule);

      await rulesApiTestUtils.rerunRule({
        prefix: config.stackName,
        ruleName: helloWorldRule.name
      });

      console.log(`Waiting for new execution of ${helloWorldRule.workflow} triggered by rerun of rule`);
      const updatedExecution = await waitForTestExecution(updatedCheck);
      const updatedTaskInput = await lambdaStep.getStepInput(updatedExecution.executionArn, 'SfSnsReport');
      expect(updatedExecution).not.toBeNull();
      expect(updatedTaskInput.meta.triggerRule).toEqual(updatedCheck);
    });
  });

  describe('When listing the rules via the API', () => {
    let listRules = '';

    beforeAll(async () => {
      const listRulesResponse = await rulesApiTestUtils.listRules({
        prefix: config.stackName
      });

      listRules = JSON.parse(listRulesResponse.body);
    });

    it('the rule is returned with the listed rules', () => {
      const rule = listRules.results.find((result) => result.name === helloWorldRule.name);
      expect(rule).toBeDefined();
      const updatedOriginal = helloWorldRule;
      updatedOriginal.meta.triggerRule = updatedCheck;

      const ruleCopy = removeRuleAddedParams(rule);
      expect(ruleCopy).toEqual(updatedOriginal);
    });
  });
});
