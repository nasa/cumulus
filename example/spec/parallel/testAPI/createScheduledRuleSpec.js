'use strict';

const {
  addCollections,
  cleanupCollections,
  waitForTestExecutionStart,
} = require('@cumulus/integration-tests');

const rulesApi = require('@cumulus/api-client/rules');
const { deleteExecution } = require('@cumulus/api-client/executions');

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
  let executionArn;

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
    console.log(`creating rule ${scheduledRuleName}`);
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
    await deleteExecution({ prefix: config.stackName, executionArn });
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

      executionArn = execution.executionArn;

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
