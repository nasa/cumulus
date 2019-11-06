'use strict';

const clonedeep = require('lodash.clonedeep');

const {
  addCollections,
  cleanupCollections,
  isWorkflowTriggeredByRule,
  removeRuleAddedParams,
  rulesApi: rulesApiTestUtils,
  waitForTestExecutionStart
} = require('@cumulus/integration-tests');

const { sns, lambda } = require('@cumulus/common/aws');
const { LambdaStep } = require('@cumulus/common/sfnStep');

const {
  createTestSuffix,
  createTimestampedTestId,
  loadConfig,
  timestampedName
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
  } catch (e) {
    return e.message;
  }
}

describe('The SNS-type rule', () => {
  let config;
  let consumerName;
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

  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  beforeAll(async () => {
    lambdaStep = new LambdaStep();
    SNS = sns();
    config = await loadConfig();
    const testId = createTimestampedTestId(config.stackName, 'SnsRule');
    testSuffix = createTestSuffix(testId);
    ruleName = timestampedName('SnsRuleIntegrationTestRule');
    const snsTopicName = timestampedName(`${config.stackName}_SnsRuleIntegrationTestTopic`);
    newValueTopicName = timestampedName(`${config.stackName}_SnsRuleValueChangeTestTopic`);
    consumerName = `${config.stackName}-messageConsumer`;

    snsMessage = '{"Data":{}}';
    // eslint-disable-next-line global-require
    snsRuleDefinition = clonedeep(require('./snsRuleDef.json'));
    snsRuleDefinition.name = ruleName;
    snsRuleDefinition.meta.triggerRule = ruleName;
    process.env.stackName = config.stackName;

    snsRuleDefinition.collection = {
      name: `MOD09GQ${testSuffix}`, version: '006'
    };

    await addCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix, testId);
    const { TopicArn } = await SNS.createTopic({ Name: snsTopicName }).promise();
    snsTopicArn = TopicArn;
    snsRuleDefinition.rule.value = TopicArn;
    const postRuleResponse = await rulesApiTestUtils.postRule({
      prefix: config.stackName,
      rule: snsRuleDefinition
    });
    postRule = JSON.parse(postRuleResponse.body);
  });

  afterAll(async () => {
    await SNS.deleteTopic({ TopicArn: snsTopicArn }).promise();

    try {
      const permissionParams = {
        FunctionName: consumerName,
        StatementId: `${ruleName}Permission`
      };
      await lambda().removePermission(permissionParams).promise();
    } catch (err) {
      // If the deletion test passed, this _should_ fail.  This is just handling
      // the case where the deletion test did not properly clean this up.
    }

    console.log(`deleting rule ${snsRuleDefinition.name}`);

    await rulesApiTestUtils.deleteRule({
      prefix: config.stackName,
      ruleName: snsRuleDefinition.name
    });
    await cleanupCollections(config.stackName, config.bucket, collectionsDir,
      testSuffix);
  });

  describe('on creation', () => {
    it('is returned in the post response', () => {
      const responseCopy = removeRuleAddedParams(postRule.record);
      delete responseCopy.rule.arn;
      expect(responseCopy).toEqual(snsRuleDefinition);
    });

    it('is enabled by default', () => {
      expect(postRule.record.state).toEqual('ENABLED');
    });

    it('creates a subscription when it is created in an enabled state', async () => {
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(1);
    });

    it('creates a policy when it is created in an enabled state', async () => {
      const { Policy } = await lambda().getPolicy({
        FunctionName: consumerName
      }).promise();

      const statementSids = JSON.parse(Policy).Statement.map((s) => s.Sid);

      expect(statementSids).toContain(`${ruleName}Permission`);
    });
  });

  describe('when an SNS message is published', () => {
    let execution;

    beforeAll(async () => {
      await SNS.publish({ Message: snsMessage, TopicArn: snsTopicArn }).promise();
      execution = await waitForTestExecutionStart({
        workflowName: snsRuleDefinition.workflow,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: isWorkflowTriggeredByRule,
        findExecutionFnParams: { rule: ruleName },
        startTask: 'HelloWorld'
      });
    });

    it('triggers the workflow', () => {
      console.log('Execution: ', JSON.stringify(execution));
      expect(execution).toBeDefined();
    });

    it('passes the message as payload', async () => {
      const executionInput = await lambdaStep.getStepInput(execution.executionArn, 'HelloWorld');
      expect(executionInput.payload).toEqual(JSON.parse(snsMessage));
    });
  });

  describe('on update to a disabled state', () => {
    beforeAll(async () => {
      const putRuleResponse = await rulesApiTestUtils.updateRule({
        prefix: config.stackName,
        ruleName,
        updateParams: {
          ...postRule.record,
          state: 'DISABLED'
        }
      });
      updatedRule = JSON.parse(putRuleResponse.body);
    });

    it('saves its new state', () => {
      expect(updatedRule.state).toBe('DISABLED');
    });

    it('deletes the policy and subscription', async () => {
      expect(await shouldCatchPolicyError(consumerName)).toEqual(policyErrorMessage);
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(0);
    });
  });

  describe('on update to an enabled state', () => {
    beforeAll(async () => {
      const putRuleResponse = await rulesApiTestUtils.updateRule({
        prefix: config.stackName,
        ruleName,
        updateParams: {
          ...updatedRule,
          state: 'ENABLED'
        }
      });
      updatedRule = JSON.parse(putRuleResponse.body);
    });

    it('saves its new state', () => {
      expect(updatedRule.state).toBe('ENABLED');
    });

    it('re-adds the subscription', async () => {
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(1);
    });
  });

  describe('on update with a rule.value change', () => {
    let putRule;

    beforeAll(async () => {
      const { TopicArn } = await SNS.createTopic({ Name: newValueTopicName }).promise();
      newTopicArn = TopicArn;
      const putRuleResponse = await rulesApiTestUtils.updateRule({
        prefix: config.stackName,
        ruleName,
        updateParams: {
          ...postRule.record,
          rule: {
            value: TopicArn,
            type: 'sns'
          }
        }
      });
      putRule = JSON.parse(putRuleResponse.body);
    });

    afterAll(async () => {
      await rulesApiTestUtils.updateRule({
        prefix: config.stackName,
        ruleName,
        updateParams: {
          ...postRule.record,
          state: 'DISABLED'
        }
      });
      await SNS.deleteTopic({ TopicArn: newTopicArn }).promise();
    });

    it('saves the new rule.value', () => {
      expect(putRule.rule.value).toEqual(newTopicArn);
    });

    it('deletes the old subscription', async () => {
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(0);
    });

    it('adds the new policy and subscription', async () => {
      const { Policy } = await lambda().getPolicy({ FunctionName: consumerName }).promise();
      const { Statement } = JSON.parse(Policy);
      expect(Statement.length).toEqual(1);
      expect(Statement[0].Sid).toEqual(`${ruleName}Permission`);
      expect(await getNumberOfTopicSubscriptions(newTopicArn)).toBe(1);
    });
  });

  describe('when subscribed to a topic where the subscription already exists', () => {
    let subscriptionArn;
    let putRule;

    beforeAll(async () => {
      const { TopicArn } = await SNS.createTopic({ Name: newValueTopicName }).promise();
      newTopicArn = TopicArn;
      const subscriptionParams = {
        TopicArn,
        Protocol: 'lambda',
        Endpoint: (await lambda().getFunction({ FunctionName: consumerName }).promise()).Configuration.FunctionArn,
        ReturnSubscriptionArn: true
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
            type: 'sns'
          },
          state: 'ENABLED'
        }
      });
      putRule = JSON.parse(putRuleResponse.body);
    });

    it('uses the existing subscription', () => {
      expect(putRule.rule.arn).toEqual(subscriptionArn);
    });
  });

  describe('on deletion', () => {
    let getRule;

    beforeAll(async () => {
      console.log(`deleting rule ${snsRuleDefinition.name}`);
      await rulesApiTestUtils.deleteRule({ prefix: config.stackName, ruleName });
      const getRuleResponse = await rulesApiTestUtils.deleteRule({ prefix: config.stackName, ruleName });
      getRule = JSON.parse(getRuleResponse.body);
    });

    afterAll(async () => {
      await SNS.deleteTopic({ TopicArn: newTopicArn }).promise();
    });

    it('is removed from the rules API', () => {
      expect(getRule.message.includes('No record found')).toBe(true);
    });

    it('deletes the policy and subscription', async () => {
      expect(await shouldCatchPolicyError(consumerName)).toEqual(policyErrorMessage);
      expect(await getNumberOfTopicSubscriptions(newTopicArn)).toBe(0);
    });
  });
});
