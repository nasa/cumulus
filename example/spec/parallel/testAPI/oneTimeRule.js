'use strict';

const cloneDeep = require('lodash.clonedeep');

const {
  rulesApi: rulesApiTestUtils,
  getExecutions,
  timeout,
  LambdaStep,
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  timestampedName
} = require('../../helpers/testUtils');

const config = loadConfig();

const lambdaStep = new LambdaStep();

const waitPeriodMs = 1000;

const maxWaitForStartedExecutionSecs = 60 * 5;

const ruleName = timestampedName('HelloWorldIntegrationTestRule');
const helloWorldRule = {
  name: ruleName,
  workflow: 'HelloWorldWorkflow',
  rule: {
    type: 'onetime'
  },
  meta: {
    triggerRule: ruleName // used to detect that we're looking at the correct execution
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
 * @returns {undefined} - none
 */
async function waitForTestExecution() {
  let timeWaitedSecs = 0;
  let workflowExecution;

  /* eslint-disable no-await-in-loop */
  while (timeWaitedSecs < maxWaitForStartedExecutionSecs && workflowExecution === undefined) {
    await timeout(waitPeriodMs);
    timeWaitedSecs += (waitPeriodMs / 1000);
    const executions = await getExecutions(helloWorldRule.workflow, config.stackName, config.bucket);

    for (const execution of executions) {
      const taskInput = await lambdaStep.getStepInput(execution.executionArn, 'SfSnsReport');
      if (taskInput && taskInput.meta.triggerRule && taskInput.meta.triggerRule === helloWorldRule.name) {
        workflowExecution = execution;
        break;
      }
    }
  }
  /* eslint-disable no-await-in-loop */
  if (timeWaitedSecs < maxWaitForStartedExecutionSecs) return workflowExecution;
  throw new Error('Never found started workflow.');
}

describe('When I create a one-time rule via the Cumulus API', () => {
  let postRuleResponse = '';

  beforeAll(async () => {
    // Create a one-time rule
    postRuleResponse = await rulesApiTestUtils.postRule({
      prefix: config.stackName,
      rule: helloWorldRule
    });
  });

  afterAll(async () => {
    console.log(`deleting rule ${helloWorldRule.name}`);
    await rulesApiTestUtils.deleteRule({
      prefix: config.stackName,
      ruleName: helloWorldRule.name
    });
  });

  it('the rule is returned in the post response', () => {
    const responseCopy = removeRuleAddedParams(postRuleResponse.record);

    expect(responseCopy).toEqual(helloWorldRule);
  });

  it('the rule is enabled by default', () => {
    expect(postRuleResponse.record.state).toEqual('ENABLED');
  });

  describe('Upon rule creation', () => {
    let execution;

    beforeAll(async () => {
      console.log(`Waiting for execution of ${helloWorldRule.workflow} triggered by rule`);
      execution = await waitForTestExecution();
      console.log(`Execution ARN: ${execution.executionArn}`);
    });

    it('a workflow is triggered by the rule', () => {
      expect(execution).toBeDefined();
    });
  });

  describe('When listing the rules via the API', () => {
    let listRulesResponse = '';

    beforeAll(async () => {
      listRulesResponse = await rulesApiTestUtils.listRules({
        prefix: config.stackName
      });

      console.log(JSON.stringify(listRulesResponse));
    });

    it('the rule is returned with the listed rules', () => {
      const rule = listRulesResponse.results.find((result) => result.name === helloWorldRule.name);
      expect(rule).toBeDefined();

      const ruleCopy = removeRuleAddedParams(rule);
      expect(ruleCopy).toEqual(helloWorldRule);
    });
  });

  it('the rule can be updated', async () => {
    const updatingRuleResponse = await rulesApiTestUtils.updateRule({
      prefix: config.stackName,
      rule: helloWorldRule,
      updateParams: { newParam: true }
    });

    expect(updatingRuleResponse).not.toBeNull;
    expect(updatingRuleResponse.newParam).toEqual(true);
  });
});
