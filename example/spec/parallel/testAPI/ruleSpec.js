'use strict';

const {
  rulesApi: rulesApiTestUtils,
  isWorkflowTriggeredByRule,
  LambdaStep,
  removeRuleAddedParams,
  waitForTestExecutionStart
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  timestampedName
} = require('../../helpers/testUtils');

const config = loadConfig();

const lambdaStep = new LambdaStep();

describe('When I create a scheduled rule via the Cumulus API', () => {
  let execution;
  const scheduledRuleName = timestampedName('SchedHelloWorldTest');
  const scheduledHelloWorldRule = {
    name: scheduledRuleName,
    workflow: 'HelloWorldWorkflow',
    rule: {
      type: 'scheduled',
      value: 'rate(2 minutes)'
    },
    meta: {
      triggerRule: scheduledRuleName
    }
  };

  beforeAll(async () => {
    // Create a scheduled rule
    await rulesApiTestUtils.postRule({
      prefix: config.prefix,
      rule: scheduledHelloWorldRule
    });
  });

  describe('The scheduled rule kicks off a workflow', () => {
    beforeAll(async () => {
      execution = await waitForTestExecutionStart({
        workflowName: scheduledHelloWorldRule.workflow,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: (taskInput, params) =>
          taskInput.meta.triggerRule && (taskInput.meta.triggerRule === params.ruleName),
        findExecutionFnParams: { ruleName: scheduledRuleName }
      });

      console.log(`Scheduled Execution ARN: ${execution.executionArn}`);
    });

    it('an execution record exists', () => {
      expect(execution).toBeDefined();
    });
  });

  describe('When the scheduled rule is deleted', () => {
    beforeAll(async () => {
      console.log(`deleting rule ${scheduledHelloWorldRule.name}`);

      await rulesApiTestUtils.deleteRule({
        prefix: config.prefix,
        ruleName: scheduledHelloWorldRule.name
      });
    });

    it('does not kick off a scheduled workflow', () => {
      waitForTestExecutionStart({
        workflowName: scheduledHelloWorldRule.workflow,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: (taskInput, params) =>
          taskInput.meta.triggerRule &&
            (taskInput.meta.triggerRule === params.ruleName) &&
            (taskInput.cumulus_meta.execution_name !== params.execution.name),
        findExecutionFnParams: { ruleName: scheduledRuleName, execution }
      }).catch((err) => expect(err.message).toEqual('Never found started workflow'));
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
      prefix: config.prefix,
      rule: helloWorldRule
    });
    postRule = JSON.parse(postRuleResponse.body);
  });

  afterAll(async () => {
    console.log(`deleting rule ${helloWorldRule.name}`);

    await rulesApiTestUtils.deleteRule({
      prefix: config.prefix,
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

      execution = await waitForTestExecutionStart({
        workflowName: helloWorldRule.workflow,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: isWorkflowTriggeredByRule,
        findExecutionFnParams: { rule: createdCheck }
      });
      console.log(`Execution ARN: ${execution.executionArn}`);
    });

    it('a workflow is triggered by the rule', () => {
      expect(execution).toBeDefined();
    });

    it('the rule can be updated', async () => {
      const updatingRuleResponse = await rulesApiTestUtils.updateRule({
        prefix: config.prefix,
        ruleName: helloWorldRule.name,
        updateParams: {
          meta: {
            triggerRule: updatedCheck
          }
        }
      });

      const updatedRule = JSON.parse(updatingRuleResponse.body);
      console.log('Updated Rule', updatedRule);

      await rulesApiTestUtils.rerunRule({
        prefix: config.prefix,
        ruleName: helloWorldRule.name
      });

      console.log(`Waiting for new execution of ${helloWorldRule.workflow} triggered by rerun of rule`);
      const updatedExecution = await waitForTestExecutionStart({
        workflowName: helloWorldRule.workflow,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: isWorkflowTriggeredByRule,
        findExecutionFnParams: { rule: updatedCheck }
      });
      const updatedTaskInput = await lambdaStep.getStepInput(updatedExecution.executionArn, 'SfSnsReport');
      expect(updatedExecution).not.toBeNull();
      expect(updatedTaskInput.meta.triggerRule).toEqual(updatedCheck);
    });
  });

  describe('When listing the rules via the API', () => {
    let listRules = '';

    beforeAll(async () => {
      const listRulesResponse = await rulesApiTestUtils.listRules({
        prefix: config.prefix
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
