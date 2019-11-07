'use strict';

const { LambdaStep } = require('@cumulus/common/sfnStep');
const {
  addCollections,
  cleanupCollections,
  isWorkflowTriggeredByRule,
  removeRuleAddedParams,
  rulesApi: rulesApiTestUtils,
  waitForTestExecutionStart
} = require('@cumulus/integration-tests');

const {
  createTestSuffix,
  createTimestampedTestId,
  loadConfig,
  timestampedName
} = require('../../helpers/testUtils');

describe('When I create a scheduled rule via the Cumulus API', () => {
  let config;
  let execution;
  let scheduledRuleName;
  let scheduledHelloWorldRule;
  let testSuffix;
  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  beforeAll(async () => {
    config = await loadConfig();
    process.env.stackName = config.stackName;

    const testId = createTimestampedTestId(config.stackName, 'Rule');
    testSuffix = createTestSuffix(testId);
    scheduledRuleName = timestampedName('SchedHelloWorldTest');
    scheduledHelloWorldRule = {
      name: scheduledRuleName,
      collection: { name: `MOD09GQ${testSuffix}`, version: '006' },
      workflow: 'HelloWorldWorkflow',
      rule: {
        type: 'scheduled',
        value: 'rate(2 minutes)'
      },
      meta: {
        triggerRule: scheduledRuleName
      }
    };

    await addCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix, testId);
    // Create a scheduled rule
    console.log(`post rule ${scheduledRuleName}`);
    await rulesApiTestUtils.postRule({
      prefix: config.stackName,
      rule: scheduledHelloWorldRule
    });
  });

  afterAll(async () => {
    console.log(`deleting rule ${scheduledRuleName}`);

    await rulesApiTestUtils.deleteRule({
      prefix: config.stackName,
      ruleName: scheduledRuleName
    });
    await cleanupCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix);
  });

  describe('The scheduled rule kicks off a workflow', () => {
    beforeAll(async () => {
      execution = await waitForTestExecutionStart({
        workflowName: scheduledHelloWorldRule.workflow,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: (taskInput, params) =>
          taskInput.meta.triggerRule && (taskInput.meta.triggerRule === params.ruleName),
        findExecutionFnParams: { ruleName: scheduledRuleName },
        startTask: 'HelloWorld'
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
        prefix: config.stackName,
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
        findExecutionFnParams: { ruleName: scheduledRuleName, execution },
        startTask: 'HelloWorld'
      }).catch((err) =>
        expect(err.message).toEqual('Never found started workflow.'));
    });
  });
});

describe('When I create a one-time rule via the Cumulus API', () => {
  let config;
  let createdCheck;
  let helloWorldRule;
  let lambdaStep;
  let postRule;
  let testSuffix;
  let updatedCheck;
  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  beforeAll(async () => {
    config = await loadConfig();
    process.env.stackName = config.stackName;

    lambdaStep = new LambdaStep();

    const testId = createTimestampedTestId(config.stackName, 'Rule');
    testSuffix = createTestSuffix(testId);

    const oneTimeRuleName = timestampedName('HelloWorldIntegrationTestRule');
    createdCheck = timestampedName('Created');
    updatedCheck = timestampedName('Updated');
    helloWorldRule = {
      name: oneTimeRuleName,
      collection: { name: `MOD09GQ${testSuffix}`, version: '006' },
      workflow: 'HelloWorldWorkflow',
      rule: {
        type: 'onetime'
      },
      meta: {
        triggerRule: createdCheck // used to detect that we're looking at the correct execution
      }
    };

    await addCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix, testId);
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
    await cleanupCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix);
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
        findExecutionFnParams: { rule: createdCheck },
        startTask: 'HelloWorld'
      });
      console.log(`Execution ARN: ${execution.executionArn}`);
    });

    it('a workflow is triggered by the rule', () => {
      expect(execution).toBeDefined();
    });

    it('the rule can be updated', async () => {
      const updatingRuleResponse = await rulesApiTestUtils.updateRule({
        prefix: config.stackName,
        ruleName: helloWorldRule.name,
        updateParams: {
          ...postRule.record,
          meta: {
            triggerRule: updatedCheck
          }
        }
      });

      const updatedRule = JSON.parse(updatingRuleResponse.body);

      await rulesApiTestUtils.rerunRule({
        prefix: config.stackName,
        ruleName: helloWorldRule.name,
        updateParams: { ...updatedRule }
      });

      console.log(`Waiting for new execution of ${helloWorldRule.workflow} triggered by rerun of rule`);
      const updatedExecution = await waitForTestExecutionStart({
        workflowName: helloWorldRule.workflow,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: isWorkflowTriggeredByRule,
        findExecutionFnParams: { rule: updatedCheck },
        startTask: 'HelloWorld'
      });
      const updatedTaskInput = await lambdaStep.getStepInput(updatedExecution.executionArn, 'HelloWorld');
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
