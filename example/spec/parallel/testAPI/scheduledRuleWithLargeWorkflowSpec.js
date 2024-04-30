'use strict';

const {
  addCollections,
  cleanupCollections,
  waitForTestExecutionStart,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');

const rulesApi = require('@cumulus/api-client/rules');
const { getExecution, deleteExecution } = require('@cumulus/api-client/executions');

const { randomId } = require('@cumulus/common/test-utils');

const {
  waitForApiStatus,
} = require('../../helpers/apiUtils');
const {
  createTestSuffix,
  createTimestampedTestId,
  loadConfig,
  timestampedName,
} = require('../../helpers/testUtils');

describe('When I create a scheduled rule that targets a state machine with > 9k characters', () => {
  let beforeAllError;
  let config;
  let execution;
  let executionArn;
  let executionFinalStatus;
  let executionName;
  let executionNamePrefix;
  let scheduledHelloWorldRule;
  let scheduledRuleName;
  let testSuffix;

  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  beforeAll(async () => {
    try {
      config = await loadConfig();
      process.env.stackName = config.stackName;

      executionNamePrefix = randomId('prefix');

      const testId = createTimestampedTestId(config.stackName, 'SchedRulePrefix');
      testSuffix = createTestSuffix(testId);
      scheduledRuleName = timestampedName('SRLSM');
      scheduledHelloWorldRule = {
        name: scheduledRuleName,
        collection: { name: `MOD09GQ${testSuffix}`, version: '006' },
        workflow: 'LargeWorkflow',
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
      executionFinalStatus = await waitForCompletedExecution(execution.executionArn);
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

    await waitForApiStatus(
      getExecution,
      { prefix: config.stackName, arn: executionArn },
      'completed'
    );
    await deleteExecution({ prefix: config.stackName, executionArn });

    await cleanupCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix);
  });

  beforeEach(() => {
    if (beforeAllError) fail(beforeAllError);
  });

  it('the triggered execution has the requested prefix', () => {
    if (beforeAllError) fail(beforeAllError);
    expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
  });

  it('completes the workflow with the status "SUCCEEDED"', () => {
    expect(executionFinalStatus).toBe('SUCCEEDED');
  });
});
