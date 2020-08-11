const test = require('ava');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');

const { fakeRuleFactoryV2 } = require('../../../lib/testUtils');
const Rule = require('../../../models/rules');

const workflow = randomString();
let rulesModel;
let sandbox;

test.before(async () => {
  process.env.RulesTable = `RulesTable_${randomString()}`;
  process.env.stackName = randomString();
  process.env.messageConsumer = randomString();
  process.env.KinesisInboundEventLogger = randomString();
  process.env.system_bucket = randomString();

  rulesModel = new Rule();
  await rulesModel.createTable();

  await createBucket(process.env.system_bucket);

  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const templateFile = `${process.env.stackName}/workflow_template.json`;
  await Promise.all([
    putJsonS3Object(
      process.env.system_bucket,
      workflowfile,
      {}
    ),
    putJsonS3Object(
      process.env.system_bucket,
      templateFile,
      {}
    ),
  ]);

  sandbox = sinon.createSandbox();
  sandbox.stub(awsServices, 'lambda')
    .returns({
      addPermission: () => ({
        promise: () => Promise.resolve(),
      }),
      removePermission: () => ({
        promise: () => Promise.resolve(),
      }),
    });
});

test.after.always(async () => {
  // cleanup table
  sandbox.restore();
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('creating a disabled SNS rule creates no event source mapping', async (t) => {
  const snsTopicArn = randomString();
  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'DISABLED',
  });

  const rule = await rulesModel.create(item);

  t.is(rule.state, 'DISABLED');
  t.is(rule.rule.value, snsTopicArn);
  t.falsy(rule.rule.arn);
});

test.serial('disabling an SNS rule removes the event source mapping', async (t) => {
  const snsTopicArn = randomString();
  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => ({
        promise: () => Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: snsTopicArn,
          }],
        }),
      }),
      unsubscribe: () => ({
        promise: () => Promise.resolve(),
      }),
    });

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const rule = await rulesModel.create(item);

  t.is(rule.rule.value, snsTopicArn);
  t.truthy(rule.rule.arn);
  t.is(rule.state, 'ENABLED');

  const updates = { name: rule.name, state: 'DISABLED' };
  const updatedRule = await rulesModel.update(rule, updates);

  t.is(updatedRule.name, rule.name);
  t.is(updatedRule.state, 'DISABLED');
  t.is(updatedRule.rule.type, rule.rule.type);
  t.is(updatedRule.rule.value, rule.rule.value);
  t.falsy(updatedRule.rule.arn);

  await rulesModel.delete(rule);
  t.teardown(() => snsStub.restore());
});

test.serial('enabling a disabled SNS rule and passing rule.arn throws specific error', async (t) => {
  const snsTopicArn = randomString();
  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => ({
        promise: () => Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: snsTopicArn,
          }],
        }),
      }),
      unsubscribe: () => ({
        promise: () => Promise.resolve(),
      }),
    });

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'DISABLED',
  });

  const rule = await rulesModel.create(item);

  t.is(rule.rule.value, snsTopicArn);
  t.falsy(rule.rule.arn);
  t.is(rule.state, 'DISABLED');

  const updates = {
    name: rule.name,
    state: 'ENABLED',
    rule: {
      ...rule.rule,
      arn: 'test-value',
    },
  };

  // Should fail because a disabled rule should not have an ARN
  // when being updated
  await t.throwsAsync(rulesModel.update(rule, updates), null,
    'Including rule.arn is not allowed when enabling a disabled rule');
  t.teardown(async () => {
    await rulesModel.delete(rule);
    snsStub.restore();
  });
});

test.serial('updating an SNS rule updates the event source mapping', async (t) => {
  const snsTopicArn = randomString();
  const newSnsTopicArn = randomString();

  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => ({
        promise: () => Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        }),
      }),
      unsubscribe: () => ({
        promise: () => Promise.resolve(),
      }),
    });

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const rule = await rulesModel.create(item);

  t.is(rule.rule.value, snsTopicArn);

  const updates = { name: rule.name, rule: { value: newSnsTopicArn } };
  const updatedRule = await rulesModel.update(rule, updates);

  t.is(updatedRule.name, rule.name);
  t.is(updatedRule.type, rule.type);
  t.is(updatedRule.rule.value, newSnsTopicArn);
  t.not(updatedRule.rule.arn, rule.rule.arn);

  await rulesModel.delete(rule);
  t.teardown(() => snsStub.restore());
});

test.serial('deleting an SNS rule updates the event source mapping', async (t) => {
  const snsTopicArn = randomString();

  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => ({
        promise: () => Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        }),
      }),
      unsubscribe: () => ({
        promise: () => Promise.resolve(),
      }),
    });
  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const rule = await rulesModel.create(item);

  t.is(rule.rule.value, snsTopicArn);

  await rulesModel.delete(rule);

  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: rule.rule.arn,
  }));

  t.teardown(() => {
    snsStub.restore();
    unsubscribeSpy.restore();
  });
});

test.serial('multiple rules using same SNS topic can be created and deleted', async (t) => {
  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: randomId('topic'),
  }).promise();

  const rule1 = await rulesModel.create(fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
  }));
  const rule2 = await rulesModel.create(fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
  }));

  // rules share the same subscription
  t.is(rule1.rule.arn, rule2.rule.arn);

  // Have to delete rules serially otherwise all rules still exist
  // when logic to check for shared source mapping is evaluated
  await rulesModel.delete(rule1);
  await t.notThrowsAsync(rulesModel.delete(rule2));

  // Ensure that cleanup for SNS rule subscription was actually called
  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: rule1.rule.arn,
  }));

  t.teardown(async () => {
    unsubscribeSpy.restore();
    await awsServices.sns().deleteTopic({
      TopicArn,
    });
  });
});
