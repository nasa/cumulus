'use strict';

const {
  addCollections,
  cleanupCollections,
  waitForTestExecutionStart,
} = require('@cumulus/integration-tests');

const rulesApi = require('@cumulus/api-client/rules');
const { deleteExecution } = require('@cumulus/api-client/executions');

const { randomId } = require('@cumulus/common/test-utils');

const {
  createTestSuffix,
  createTimestampedTestId,
  loadConfig,
  timestampedName,
} = require('../../helpers/testUtils');

const SetupError = new Error('Test setup failed');

describe('When I create a scheduled rule with an executionNamePrefix via the Cumulus API', () => {
  let config;
  let execution;
  let executionName;
  let executionNamePrefix;
  let scheduledRuleName;
  let scheduledHelloWorldRule;
  let testSuffix;
  let executionArn;
  let beforeAllError;

  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  beforeAll(async () => {
    try {
      config = await loadConfig();
      process.env.stackName = config.stackName;

      executionNamePrefix = randomId('prefix');

      const testId = createTimestampedTestId(config.stackName, 'Rule');
      testSuffix = createTestSuffix(testId);
      scheduledRuleName = timestampedName('SchedRuleWithExecutionPrefix');
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
      console.log(`creating rule ${scheduledRuleName}`);
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

      executionArn = execution.executionArn;
      executionName = execution.executionArn.split(':').reverse()[0];
    } catch (error) {
      beforeAllError = error;
    }
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

  beforeEach(() => {
    if (beforeAllError) fail(beforeAllError);
  });

  it('the triggered execution has the requested prefix', () => {
    if (beforeAllError) fail(SetupError);
    expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
  });
});
