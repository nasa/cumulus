'use strict';

const cloneDeep = require('lodash.clonedeep');

const {
  rulesApi: rulesApiTestUtils,
  getExecutions,
  timeout,
  LambdaStep,
  waitForTestExecutionStartStart
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  timestampedName
} = require('../helpers/testUtils');

const config = loadConfig();

const lambdaStep = new LambdaStep();

const waitPeriodMs = 1000;

const maxWaitForStartedExecutionSecs = 60 * 5;

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

describe('When I create a scheduled rule via the Cumulus API', () => {
  let response;
  const scheduledRuleName = timestampedName('SchedHelloWorldIntegrationTestRule');
  const scheduledHelloWorldRule = {
    name: scheduledRuleName,
    workflow: 'HelloWorldWorkflow',
    rule: {
      type: 'scheduled',
      value: 'rate(3 minutes)'
    },
    meta: {
      triggerRule: scheduledRuleName // used to detect that we're looking at the correct execution
    }
  };

  beforeAll(async () => {
    // Create a scheduled rule
    response = await rulesApiTestUtils.postRule({
      prefix: config.stackName,
      rule: scheduledHelloWorldRule
    });
  });

  describe('the scheduled rule is deleted', () => {
    beforeAll(async () => {
      console.log(`deleting rule ${scheduledHelloWorldRule.name}`);
      await rulesApiTestUtils.deleteRule({
        prefix: config.stackName,
        ruleName: scheduledHelloWorldRule.name
      });
    });

    it('the rule does not kick off a workflow', () => {
      expect(() => waitForTestExecutionStart({
        workflowName: scheduledHelloWorldRule.workflow,
        stackName: config.stackName,
        bucket: config.bucket
        findExecutionFn: (taskInput, params) => 
          taskInput.meta.triggerRule && taskInput.meta.triggerRule === params.ruleName,
        findExecutionFnParams: { ruleName: scheduledHelloWorldRule.name }
      })).toThrowError(Error, 'Never found started workflow.');
    });
  });
});

describe('When I create a one-time rule via the Cumulus API', () => {
  let postRuleResponse = '';
  const oneTimeRuleName = timestampedName('HelloWorldIntegrationTestRule');
  const helloWorldRule = {
    name: oneTimeRuleName,
    workflow: 'HelloWorldWorkflow',
    rule: {
      type: 'onetime'
    },
    meta: {
      triggerRule: oneTimeRuleName // used to detect that we're looking at the correct execution
    }
  };

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
      execution = await waitForTestExecutionStart(
        workflowName: scheduledHelloWorldRule.workflow,
        stackName: config.stackName,
        bucket: config.bucket
        findExecutionFn: (taskInput, params) => 
          taskInput.meta.triggerRule && taskInput.meta.triggerRule === params.ruleName,
        findExecutionFnParams: { ruleName: scheduledHelloWorldRule.name }
      );
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
});
