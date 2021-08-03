'use strict';

const path = require('path');
const { readJson } = require('fs-extra');

const {
  addCollections,
  cleanupCollections,
  isWorkflowTriggeredByRule,
  removeRuleAddedParams,
  rulesApi: rulesApiTestUtils,
  waitForTestExecutionStart,
} = require('@cumulus/integration-tests');

const { deleteExecution } = require('@cumulus/api-client/executions');
const { sns, lambda } = require('@cumulus/aws-client/services');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { randomId } = require('@cumulus/common/test-utils');

const {
  createTestSuffix,
  createTimestampedTestId,
  loadConfig,
  timestampedName,
} = require('../../helpers/testUtils');

async function getNumberOfTopicSubscriptions(snsTopicArn) {
  const subs = await sns().listSubscriptionsByTopic({ TopicArn: snsTopicArn }).promise();
  return subs.Subscriptions.length;
}

const policyErrorMessage = 'The resource you requested does not exist.';

async function shouldCatchPolicyError(consumerName) {
  try {
    await lambda().getPolicy({ FunctionName: consumerName }).promise();
    return undefined;
  } catch (error) {
    return error.message;
  }
}

describe('The SNS-type rule', () => {
  let config;
  let consumerName;
  let executionNamePrefix;
  let lambdaStep;
  let newTopicArn;
  let newValueTopicName;
  let postRule;
  let ruleName;
  let SNS;
  let snsMessage;
  let snsRuleDefinition;
  let snsTopicArn;
  let testSuffix;
  let updatedRule;
  let helloWorldExecutionArn;
  let beforeAllFailed;

  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  beforeAll(async () => {
    try {
      lambdaStep = new LambdaStep();
      SNS = sns();
      config = await loadConfig();
      const testId = createTimestampedTestId(config.stackName, 'SnsRule');
      testSuffix = createTestSuffix(testId);
      ruleName = timestampedName('SnsRuleIntegrationTestRule');
      const snsTopicName = timestampedName(`${config.stackName}_SnsRuleIntegrationTestTopic`);
      newValueTopicName = timestampedName(`${config.stackName}_SnsRuleValueChangeTestTopic`);
      consumerName = `${config.stackName}-messageConsumer`;

      executionNamePrefix = randomId('prefix');

      snsMessage = JSON.stringify({ Data: {} });
      snsRuleDefinition = await readJson(path.join(__dirname, 'snsRuleDef.json'));
      snsRuleDefinition.name = ruleName;
      snsRuleDefinition.meta.triggerRule = ruleName;
      snsRuleDefinition.executionNamePrefix = executionNamePrefix;

      process.env.stackName = config.stackName;

      snsRuleDefinition.collection = {
        name: `MOD09GQ${testSuffix}`, version: '006',
      };

      await addCollections(config.stackName, config.bucket, collectionsDir,
        testSuffix, testId);
      const { TopicArn } = await SNS.createTopic({ Name: snsTopicName }).promise();
      snsTopicArn = TopicArn;
      snsRuleDefinition.rule.value = TopicArn;
      const postRuleResponse = await rulesApiTestUtils.postRule({
        prefix: config.stackName,
        rule: snsRuleDefinition,
      });
      postRule = JSON.parse(postRuleResponse.body);
    } catch (error) {
      beforeAllFailed = error;
    }
  });

  afterAll(async () => {
    await SNS.deleteTopic({ TopicArn: snsTopicArn }).promise();

    try {
      const permissionParams = {
        FunctionName: consumerName,
        StatementId: `${ruleName}Permission`,
      };
      await lambda().removePermission(permissionParams).promise();
    } catch (error) {
      // If the deletion test passed, this _should_ fail.  This is just handling
      // the case where the deletion test did not properly clean this up.
    }

    await deleteExecution({ prefix: config.stackName, executionArn: helloWorldExecutionArn });
    await cleanupCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix);
  });

  describe('on creation', () => {
    it('is returned in the post response', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const responseCopy = removeRuleAddedParams(postRule.record);
      delete responseCopy.rule.arn;
      expect(responseCopy).toEqual(snsRuleDefinition);
    });

    it('is enabled by default', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(postRule.record.state).toEqual('ENABLED');
    });

    it('creates a subscription when it is created in an enabled state', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(1);
    });

    it('creates a policy when it is created in an enabled state', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const { Policy } = await lambda().getPolicy({
        FunctionName: consumerName,
      }).promise();

      const statementSids = JSON.parse(Policy).Statement.map((s) => s.Sid);

      expect(statementSids).toContain(`${ruleName}Permission`);
    });
  });

  describe('when an SNS message is published', () => {
    let execution;

    beforeAll(async () => {
      if (beforeAllFailed) return;

      try {
        await SNS.publish({ Message: snsMessage, TopicArn: snsTopicArn }).promise();
        execution = await waitForTestExecutionStart({
          workflowName: snsRuleDefinition.workflow,
          stackName: config.stackName,
          bucket: config.bucket,
          findExecutionFn: isWorkflowTriggeredByRule,
          findExecutionFnParams: { rule: ruleName },
          startTask: 'HelloWorld',
        });

        helloWorldExecutionArn = execution.executionArn;
      } catch (error) {
        beforeAllFailed = error;
      }
    });

    it('triggers the workflow', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      console.log('Execution:', JSON.stringify(execution));
      expect(execution).toBeDefined();
    });

    it('passes the message as payload', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const executionInput = await lambdaStep.getStepInput(helloWorldExecutionArn, 'HelloWorld');
      expect(executionInput.payload).toEqual(JSON.parse(snsMessage));
    });

    it('results in an execution with the correct prefix', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const executionName = helloWorldExecutionArn.split(':').reverse()[0];

      expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
    });
  });

  describe('on update to a disabled state', () => {
    beforeAll(async () => {
      if (beforeAllFailed) return;
      try {
        const putRuleResponse = await rulesApiTestUtils.updateRule({
          prefix: config.stackName,
          ruleName,
          updateParams: {
            ...postRule.record,
            state: 'DISABLED',
          },
        });
        updatedRule = JSON.parse(putRuleResponse.body);
      } catch (error) {
        beforeAllFailed = error;
      }
    });

    it('saves its new state', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(updatedRule.state).toBe('DISABLED');
    });

    it('deletes the policy and subscription', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(await shouldCatchPolicyError(consumerName)).toEqual(policyErrorMessage);
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(0);
    });
  });

  describe('on update to an enabled state', () => {
    beforeAll(async () => {
      if (beforeAllFailed) return;
      try {
        const putRuleResponse = await rulesApiTestUtils.updateRule({
          prefix: config.stackName,
          ruleName,
          updateParams: {
            ...updatedRule,
            state: 'ENABLED',
          },
        });
        updatedRule = JSON.parse(putRuleResponse.body);
      } catch (error) {
        beforeAllFailed = error;
      }
    });

    it('saves its new state', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(updatedRule.state).toBe('ENABLED');
    });

    it('re-adds the subscription', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(1);
    });
  });

  describe('on update with a rule.value change', () => {
    let putRule;

    beforeAll(async () => {
      if (beforeAllFailed) return;
      try {
        const { TopicArn } = await SNS.createTopic({ Name: newValueTopicName }).promise();
        newTopicArn = TopicArn;
        const putRuleResponse = await rulesApiTestUtils.updateRule({
          prefix: config.stackName,
          ruleName,
          updateParams: {
            ...postRule.record,
            rule: {
              value: TopicArn,
              type: 'sns',
            },
          },
        });
        putRule = JSON.parse(putRuleResponse.body);
      } catch (error) {
        beforeAllFailed = error;
      }
    });

    afterAll(async () => {
      await rulesApiTestUtils.updateRule({
        prefix: config.stackName,
        ruleName,
        updateParams: {
          ...postRule.record,
          state: 'DISABLED',
        },
      });
      await SNS.deleteTopic({ TopicArn: newTopicArn }).promise();
    });

    it('saves the new rule.value', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(putRule.rule.value).toEqual(newTopicArn);
    });

    it('deletes the old subscription', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(0);
    });

    it('adds the new policy and subscription', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const { Policy } = await lambda().getPolicy({ FunctionName: consumerName }).promise();
      const { Statement } = JSON.parse(Policy);
      const actualStatement = Statement.find((s) => s.Sid === `${ruleName}Permission`);
      expect(actualStatement).toBeDefined();
      expect(actualStatement.Sid).toEqual(`${ruleName}Permission`);
      expect(await getNumberOfTopicSubscriptions(newTopicArn)).toBeGreaterThan(0);
    });
  });

  describe('when subscribed to a topic where the subscription already exists', () => {
    let subscriptionArn;
    let putRule;

    beforeAll(async () => {
      if (beforeAllFailed) return;
      try {
        const { TopicArn } = await SNS.createTopic({ Name: newValueTopicName }).promise();
        newTopicArn = TopicArn;
        const subscriptionParams = {
          TopicArn,
          Protocol: 'lambda',
          Endpoint: (await lambda().getFunction({ FunctionName: consumerName }).promise()).Configuration.FunctionArn,
          ReturnSubscriptionArn: true,
        };
        const { SubscriptionArn } = await SNS.subscribe(subscriptionParams).promise();
        subscriptionArn = SubscriptionArn;
        const putRuleResponse = await rulesApiTestUtils.updateRule({
          prefix: config.stackName,
          ruleName,
          updateParams: {
            ...postRule.record,
            rule: {
              value: TopicArn,
              type: 'sns',
            },
            state: 'ENABLED',
          },
        });
        putRule = JSON.parse(putRuleResponse.body);
      } catch (error) {
        beforeAllFailed = error;
      }
    });

    it('uses the existing subscription', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(putRule.rule.arn).toEqual(subscriptionArn);
    });
  });

  describe('on deletion', () => {
    let responseError;

    beforeAll(async () => {
      if (beforeAllFailed) return;
      try {
        console.log(`deleting rule ${snsRuleDefinition.name}`);
        await rulesApiTestUtils.deleteRule({ prefix: config.stackName, ruleName });

        try {
          await rulesApiTestUtils.getRule({
            prefix: config.stackName,
            ruleName,
          });
        } catch (error) {
          responseError = error;
        }
      } catch (error) {
        beforeAllFailed = error;
      }
    });

    afterAll(async () => {
      await SNS.deleteTopic({ TopicArn: newTopicArn }).promise();
    });

    it('is removed from the rules API', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(responseError.apiMessage).toContain('No record found');
    });

    it('deletes the policy and subscription', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(await shouldCatchPolicyError(consumerName)).toEqual(policyErrorMessage);
      expect(await getNumberOfTopicSubscriptions(newTopicArn)).toBe(0);
    });
  });
});
