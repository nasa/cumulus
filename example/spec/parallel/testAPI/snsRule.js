'use strict';

const {
  rulesApi: rulesApiTestUtils,
  isWorkflowTriggeredByRule,
  removeRuleAddedParams,
  waitForTestExecutionStart
} = require('@cumulus/integration-tests');

const { sns } = require('@cumulus/common/aws');

const {
  loadConfig,
  timestampedName
} = require('../../helpers/testUtils');

const SNS = sns();
const config = loadConfig();
const ruleName = timestampedName(`${config.stackName}_SnsRuleIntegrationTestRule`);
const snsTopicName = timestampedName(`${config.stackName}_SnsRuleIntegrationTestTopic`);

const snsMessage = '{\"Records\":[{}]}';

const snsRuleDefinition = {
  name: ruleName,
  workflow: 'HelloWorldWorkflow',
  rule: {
    type: 'sns'
  },
  meta: {
    triggerRule: ruleName
  }
};

async function getNumberOfTopicSubscriptions(snsTopicArn) {
  const subs = await SNS.listSubscriptionsByTopic({ TopicArn: snsTopicArn }).promise();
  return subs.Subscriptions.length;
}

describe('The SNS-type rule', () => {
  let postRule;
  let snsTopicArn;

  beforeAll(async () => {
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
    console.log(`deleting rule ${snsRuleDefinition.name}`);
    await rulesApiTestUtils.deleteRule({
      prefix: config.stackName,
      ruleName: snsRuleDefinition.name
    });
    await SNS.deleteTopic({ TopicArn: snsTopicArn }).promise();
  });

  it('is returned in the post response', () => {
    const responseCopy = removeRuleAddedParams(postRule.record);
    expect(responseCopy).toEqual(snsRuleDefinition);
  });

  it('is enabled by default', () => {
    expect(postRule.record.state).toEqual('ENABLED');
  });

  it('creates a subscription when it is created in an enabled state', async () => {
    expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(1);
  });

  describe('when an SNS message is published', () => {
    let execution;

    beforeAll(async () => {
      await SNS.publish({ Message: snsMessage, TopicArn: snsTopicArn }).promise();
      execution = await waitForTestExecutionStart(snsRuleDefinition.workflow, config.stackName, config.bucket, isWorkflowTriggeredByRule, { rule: ruleName });
    });

    it('triggers the workflow', () => {
      expect(execution).toBeDefined();
    });
  });

  describe('on update to a disabled state', () => {
    let putRule;

    beforeAll(async () => {
      const putRuleResponse = await rulesApiTestUtils.updateRule({ prefix: config.stackName, ruleName, updateParams: { state: 'DISABLED' } });
      putRule = JSON.parse(putRuleResponse.body);
    });

    it('saves its new state', () => {
      expect(putRule.record.state).toBe('DISABLED');
    });

    it('deletes the subscription', async () => {
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(0);
    });
  });

  describe('on update to an enabled state', () => {
    let putRule;

    beforeAll(async () => {
      const putRuleResponse = await rulesApiTestUtils.updateRule({ prefix: config.stackName, ruleName, updateParams: { state: 'ENABLED' } });
      putRule = JSON.parse(putRuleResponse.body);
    });

    it('saves its new state', () => {
      expect(putRule.record.state).toBe('ENABLED');
    });

    it('re-adds the subscription', async () => {
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(1);
    });
  });

  describe('on deletion', () => {
    let getRule;

    beforeAll(async () => {
      await rulesApiTestUtils.deleteRule({ prefix: config.stackName, ruleName });
      const getRuleResponse = await rulesApiTestUtils.deleteRule({ prefix: config.stackName, ruleName });
      getRule = JSON.parse(getRuleResponse.body);
    });

    it('is removed from the rules API', () => {
      expect(getRule.message.includes('No record found')).toBe(true);
    });

    it('deletes the subscription', async () => {
      expect(await getNumberOfTopicSubscriptions(snsTopicArn)).toBe(0);
    });
  });
});
