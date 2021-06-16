'use strict';

const {
  isWorkflowTriggeredByRule,
  waitForTestExecutionStart,
} = require('@cumulus/integration-tests');

const rulesApi = require('@cumulus/api-client/rules');
const { deleteExecution } = require('@cumulus/api-client/executions');

const { randomId } = require('@cumulus/common/test-utils');

const {
  loadConfig,
  timestampedName,
} = require('../../helpers/testUtils');

const SetupError = new Error('Test setup failed');

describe('When I create a one-time rule with an executionNamePrefix via the Cumulus API', () => {
  let config;
  let createdCheck;
  let execution;
  let executionName;
  let executionNamePrefix;
  let executionArn;
  let helloWorldRule;
  let beforeAllError;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      process.env.stackName = config.stackName;

      const oneTimeRuleName = timestampedName('OneTimeExecutionNamePrefix');
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
      executionArn = execution.executionArn;
      executionName = executionArn.split(':').reverse()[0];
    } catch (error) {
      beforeAllError = error;
    }
  });

  beforeEach(() => {
    if (beforeAllError) fail(beforeAllError);
  });

  afterAll(async () => {
    console.log(`deleting rule ${helloWorldRule.name}`);
    await deleteExecution({ prefix: config.stackName, executionArn });
    await rulesApi.deleteRule({
      prefix: config.stackName,
      ruleName: helloWorldRule.name,
    });
  });

  it('the triggered execution has the requested prefix', () => {
    if (beforeAllError) throw SetupError;
    expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
  });
});
