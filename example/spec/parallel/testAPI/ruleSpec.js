'use strict';

const cloneDeep = require('lodash.clonedeep');

const {
  rulesApi: rulesApiTestUtils,
  LambdaStep,
  waitForTestExecutionStart
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  timestampedName
} = require('../../helpers/testUtils');

const config = loadConfig();

const lambdaStep = new LambdaStep();

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

function isWorkflowTriggeredByRule(taskInput, params) {
  return taskInput.meta.triggerRule && taskInput.meta.triggerRule === params.rule;
}

describe('When I create a scheduled rule via the Cumulus API', () => {
  const scheduledRuleName = timestampedName('SchedHelloWorldIntegrationTestRule');
  const scheduledHelloWorldRule = {
    name: scheduledRuleName,
    workflow: 'HelloWorldWorkflow',
    rule: {
      type: 'scheduled',
      value: 'rate(3 minutes)'
    },
    meta: {
      triggerRule: scheduledRuleName
    }
  };

  beforeAll(async () => {
    // Create a scheduled rule
    await rulesApiTestUtils.postRule({
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

    it('does not kick off a workflow', () => {
      try {
        waitForTestExecutionStart(
          scheduledHelloWorldRule.workflow,
          config.stackName,
          config.bucket,
          (taskInput, params) =>
            taskInput.meta.triggerRule && (taskInput.meta.triggerRule === params.ruleName),
          { ruleName: scheduledRuleName }
        );
      }
      catch (err) {
        expect(err.message).toEqual('Never found started workflow.');
      }
    });
  });
});

describe('When I create a one-time rule via the Cumulus API', () => {
  let postRule = '';
  const oneTimeRuleName = timestampedName('HelloWorldIntegrationTestRule');
  const createdCheck = timestampedName('Created');
  const updatedCheck = timestampedName('Updated');
  const helloWorldRule = {
    name: oneTimeRuleName,
    workflow: 'HelloWorldWorkflow',
    rule: {
      type: 'onetime'
    },
    meta: {
      triggerRule: createdCheck // used to detect that we're looking at the correct execution
    }
  };

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

      execution = await waitForTestExecutionStart(helloWorldRule.workflow, config.stackName, config.bucket, isWorkflowTriggeredByRule, { rule: createdCheck });
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
      const updatedExecution = await waitForTestExecutionStart(helloWorldRule.workflow, config.stackName, config.bucket, isWorkflowTriggeredByRule, { rule: updatedCheck });
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
