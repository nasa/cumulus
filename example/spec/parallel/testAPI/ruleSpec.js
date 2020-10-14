'use strict';

const pWaitFor = require('p-wait-for');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const {
  addCollections,
  cleanupCollections,
  isWorkflowTriggeredByRule,
  waitForTestExecutionStart,
} = require('@cumulus/integration-tests');

const rulesApi = require('@cumulus/api-client/rules');

const { randomId } = require('@cumulus/common/test-utils');

const {
  createTestSuffix,
  createTimestampedTestId,
  loadConfig,
  timestampedName,
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
        value: 'rate(2 minutes)',
      },
      meta: {
        triggerRule: scheduledRuleName,
      },
    };

    await addCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix, testId);
    // Create a scheduled rule
    console.log(`post rule ${scheduledRuleName}`);
    await rulesApi.postRule({
      prefix: config.stackName,
      rule: scheduledHelloWorldRule,
    });
  });

  afterAll(async () => {
    console.log(`deleting rule ${scheduledRuleName}`);

    await rulesApi.deleteRule({
      prefix: config.stackName,
      ruleName: scheduledRuleName,
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
        startTask: 'HelloWorld',
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

      await rulesApi.deleteRule({
        prefix: config.stackName,
        ruleName: scheduledHelloWorldRule.name,
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
        startTask: 'HelloWorld',
      }).catch((error) =>
        expect(error.message).toEqual('Never found started workflow.'));
    });
  });
});

describe('When I create a scheduled rule with an executionNamePrefix via the Cumulus API', () => {
  let config;
  let execution;
  let executionName;
  let executionNamePrefix;
  let scheduledRuleName;
  let scheduledHelloWorldRule;
  let testSuffix;

  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  beforeAll(async () => {
    config = await loadConfig();
    process.env.stackName = config.stackName;

    executionNamePrefix = randomId('prefix');

    const testId = createTimestampedTestId(config.stackName, 'Rule');
    testSuffix = createTestSuffix(testId);
    scheduledRuleName = timestampedName('SchedHelloWorldTest');
    scheduledHelloWorldRule = {
      name: scheduledRuleName,
      collection: { name: `MOD09GQ${testSuffix}`, version: '006' },
      workflow: 'HelloWorldWorkflow',
      rule: {
        type: 'scheduled',
        value: 'rate(2 minutes)',
      },
      meta: {
        triggerRule: scheduledRuleName,
      },
      executionNamePrefix,
    };

    await addCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix, testId);
    // Create a scheduled rule
    console.log(`post rule ${scheduledRuleName}`);
    await rulesApi.postRule({
      prefix: config.stackName,
      rule: scheduledHelloWorldRule,
    });

    execution = await waitForTestExecutionStart({
      workflowName: scheduledHelloWorldRule.workflow,
      stackName: config.stackName,
      bucket: config.bucket,
      findExecutionFn: (taskInput, params) =>
        taskInput.meta.triggerRule && (taskInput.meta.triggerRule === params.ruleName),
      findExecutionFnParams: { ruleName: scheduledRuleName },
      startTask: 'HelloWorld',
    });

    executionName = execution.executionArn.split(':').reverse()[0];
  });

  afterAll(async () => {
    console.log(`deleting rule ${scheduledRuleName}`);

    await rulesApi.deleteRule({
      prefix: config.stackName,
      ruleName: scheduledRuleName,
    });
    await cleanupCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix);
  });

  it('the triggered execution has the requested prefix', async () => {
    expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
  });
});

describe('When I create a one-time rule via the Cumulus API', () => {
  let config;
  let createdCheck;
  let helloWorldRule;
  let lambdaStep;
  let postRule;
  let prefix;
  let updatedCheck;

  beforeAll(async () => {
    config = await loadConfig();
    prefix = config.stackName;
    process.env.stackName = config.stackName;

    lambdaStep = new LambdaStep();

    const oneTimeRuleName = timestampedName('HelloWorldIntegrationTestRule');
    createdCheck = timestampedName('Created');
    updatedCheck = timestampedName('Updated');
    helloWorldRule = {
      name: oneTimeRuleName,
      workflow: 'HelloWorldWorkflow',
      rule: {
        type: 'onetime',
      },
      meta: {
        triggerRule: createdCheck, // used to detect that we're looking at the correct execution
      },
    };

    // Create a one-time rule
    const postRuleResponse = await rulesApi.postRule({
      prefix: config.stackName,
      rule: helloWorldRule,
    });
    postRule = JSON.parse(postRuleResponse.body);
  });

  afterAll(async () => {
    console.log(`deleting rule ${helloWorldRule.name}`);
    await rulesApi.deleteRule({
      prefix: config.stackName,
      ruleName: helloWorldRule.name,
    });
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
        startTask: 'HelloWorld',
      });
      console.log(`Execution ARN: ${execution.executionArn}`);
    });

    it('the rule can be updated', async () => {
      const updatingRuleResponse = await rulesApi.updateRule({
        prefix: config.stackName,
        ruleName: helloWorldRule.name,
        updateParams: {
          ...postRule.record,
          meta: {
            triggerRule: updatedCheck,
          },
        },
      });

      const updatedRule = JSON.parse(updatingRuleResponse.body);

      await rulesApi.rerunRule({
        prefix: config.stackName,
        ruleName: helloWorldRule.name,
        updateParams: { ...updatedRule },
      });

      console.log(`Waiting for new execution of ${helloWorldRule.workflow} triggered by rerun of rule`);
      const updatedExecution = await waitForTestExecutionStart({
        workflowName: helloWorldRule.workflow,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: isWorkflowTriggeredByRule,
        findExecutionFnParams: { rule: updatedCheck },
        startTask: 'HelloWorld',
      });
      const updatedTaskInput = await lambdaStep.getStepInput(updatedExecution.executionArn, 'HelloWorld');
      expect(updatedExecution).not.toBeNull();
      expect(updatedTaskInput.meta.triggerRule).toEqual(updatedCheck);
    });
  });

  it('the rule is returned with the listed rules', async () => {
    await expectAsync(
      pWaitFor(
        async () => {
          const listRulesResponse = await rulesApi.listRules({
            prefix,
            query: {
              name: helloWorldRule.name,
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

describe('When I create a one-time rule with an executionNamePrefix via the Cumulus API', () => {
  let config;
  let createdCheck;
  let execution;
  let executionName;
  let executionNamePrefix;
  let helloWorldRule;

  beforeAll(async () => {
    config = await loadConfig();
    process.env.stackName = config.stackName;

    const oneTimeRuleName = timestampedName('HelloWorldIntegrationTestRule');
    createdCheck = timestampedName('Created');

    executionNamePrefix = randomId('prefix');

    helloWorldRule = {
      name: oneTimeRuleName,
      workflow: 'HelloWorldWorkflow',
      rule: {
        type: 'onetime',
      },
      meta: {
        triggerRule: createdCheck, // used to detect that we're looking at the correct execution
      },
      executionNamePrefix,
    };

    // Create a one-time rule
    await rulesApi.postRule({
      prefix: config.stackName,
      rule: helloWorldRule,
    });

    console.log(`Waiting for execution of ${helloWorldRule.workflow} triggered by rule`);

    execution = await waitForTestExecutionStart({
      workflowName: helloWorldRule.workflow,
      stackName: config.stackName,
      bucket: config.bucket,
      findExecutionFn: isWorkflowTriggeredByRule,
      findExecutionFnParams: { rule: createdCheck },
      startTask: 'HelloWorld',
    });

    executionName = execution.executionArn.split(':').reverse()[0];
  });

  afterAll(async () => {
    console.log(`deleting rule ${helloWorldRule.name}`);
    await rulesApi.deleteRule({
      prefix: config.stackName,
      ruleName: helloWorldRule.name,
    });
  });

  it('the triggered execution has the requested prefix', async () => {
    expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
  });
});
