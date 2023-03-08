const fs = require('fs-extra');
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
const { ResourceNotFoundError, resourceNotFoundInfo } = require('../../../lib/errors');

const workflow = randomString();
let rulesModel;

test.before(async () => {
  process.env.RulesTable = `RulesTable_${randomString()}`;
  process.env.stackName = randomString();
  process.env.KinesisInboundEventLogger = randomString();
  process.env.system_bucket = randomString();

  const lambda = await awsServices.lambda().createFunction({
    Code: {
      ZipFile: fs.readFileSync(require.resolve('@cumulus/test-data/fake-lambdas/hello.zip')),
    },
    FunctionName: randomId('messageConsumer'),
    Role: randomId('role'),
    Handler: 'index.handler',
    Runtime: 'nodejs16.x',
  }).promise();
  process.env.messageConsumer = lambda.FunctionName;

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
});

test.beforeEach(async (t) => {
  const topic = await awsServices.sns().createTopic({ Name: randomId('sns') }).promise();
  t.context.snsTopicArn = topic.TopicArn;
});

test.afterEach.always(async (t) => {
  await awsServices.sns().deleteTopic({ TopicArn: t.context.snsTopicArn }).promise();
});

test.after.always(async () => {
  // cleanup table
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('creating a disabled SNS rule creates no event source mapping', async (t) => {
  const { snsTopicArn } = t.context;
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
  const { snsTopicArn } = t.context;

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const rule = await rulesModel.createRuleTrigger(item);
  await rulesModel.create(rule);

  t.is(rule.rule.value, snsTopicArn);
  t.truthy(rule.rule.arn);
  t.is(rule.state, 'ENABLED');

  const updates = { name: rule.name, state: 'DISABLED' };
  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

  t.is(updatedRule.name, rule.name);
  t.is(updatedRule.state, 'DISABLED');
  t.is(updatedRule.rule.type, rule.rule.type);
  t.is(updatedRule.rule.value, rule.rule.value);
  t.falsy(updatedRule.rule.arn);

  t.teardown(() => rulesModel.delete(rule));
});

test.serial('enabling a disabled SNS rule and passing rule.arn throws specific error', async (t) => {
  const { snsTopicArn } = t.context;

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'DISABLED',
  });

  const ruleWithTrigger = await rulesModel.createRuleTrigger(item);
  const rule = await rulesModel.create(ruleWithTrigger);

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
  await t.throwsAsync(rulesModel.updateRuleTrigger(rule, updates), null,
    'Including rule.arn is not allowed when enabling a disabled rule');
  t.teardown(() => rulesModel.delete(rule));
});

test.serial('updating an SNS rule updates the event source mapping', async (t) => {
  const { snsTopicArn } = t.context;
  const { TopicArn: newSnsTopicArn } = await awsServices.sns().createTopic({ Name: randomId('sns') }).promise();

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const ruleWithTrigger = await rulesModel.createRuleTrigger(item);
  const rule = await rulesModel.create(ruleWithTrigger);

  t.is(rule.rule.value, snsTopicArn);

  const updates = { name: rule.name, rule: { value: newSnsTopicArn } };
  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

  t.is(updatedRule.name, rule.name);
  t.is(updatedRule.type, rule.type);
  t.is(updatedRule.rule.value, newSnsTopicArn);
  t.not(updatedRule.rule.arn, rule.rule.arn);

  t.teardown(() => rulesModel.delete(rule));
});

test.serial('deleting an SNS rule updates the event source mapping', async (t) => {
  const { snsTopicArn } = t.context;

  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const ruleWithTrigger = await rulesModel.createRuleTrigger(item);
  const rule = await rulesModel.create(ruleWithTrigger);

  t.is(rule.rule.value, snsTopicArn);

  await rulesModel.delete(rule);

  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: rule.rule.arn,
  }));

  t.teardown(() => {
    unsubscribeSpy.restore();
  });
});

test.serial('multiple rules using same SNS topic can be created and deleted', async (t) => {
  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: randomId('topic'),
  }).promise();

  const ruleWithTrigger = await rulesModel.createRuleTrigger(fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
  }));
  const rule1 = await rulesModel.create(ruleWithTrigger);
  const ruleWithTrigger2 = await rulesModel.createRuleTrigger(fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
  }));
  const rule2 = await rulesModel.create(ruleWithTrigger2);

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

test.serial('deleteSnsTrigger throws more detailed ResourceNotFoundError', async (t) => {
  const errorMessage = 'Resource is not found in resource policy.';
  const error = new Error(errorMessage);
  error.code = 'ResourceNotFoundException';
  const { snsTopicArn } = t.context;
  const lambdaStub = sinon.stub(awsServices.lambda(), 'removePermission').throws(error);

  const ruleWithTrigger = await rulesModel.createRuleTrigger(fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    workflow,
    state: 'ENABLED',
  }));
  const rule = await rulesModel.create(ruleWithTrigger);

  await t.throwsAsync(
    rulesModel.deleteSnsTrigger(rule), {
      instanceOf: ResourceNotFoundError,
      message: `${errorMessage} ${resourceNotFoundInfo}`,
    }
  );

  t.teardown(async () => {
    lambdaStub.restore();
    await rulesModel.delete(rule);
  });
});
