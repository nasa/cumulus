const fs = require('fs-extra');
const test = require('ava');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const {
  destroyLocalTestDb,
  generateLocalTestDb,
  migrationDir,
  RulePgModel,
} = require('@cumulus/db');
const { randomId, randomString } = require('@cumulus/common/test-utils');

const rulesHelpers = require('../../lib/rulesHelpers');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');
const { ResourceNotFoundError, resourceNotFoundInfo } = require('../../lib/errors');

const workflow = randomString();
const testDbName = randomString(12);

test.before(async (t) => {
  process.env.RulesTable = `RulesTable_${randomString()}`;
  process.env.stackName = randomString();
  process.env.KinesisInboundEventLogger = randomString();
  process.env.system_bucket = randomString();

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;
  t.context.rulePgModel = new RulePgModel();

  const lambda = await awsServices.lambda().createFunction({
    Code: {
      ZipFile: fs.readFileSync(require.resolve('@cumulus/test-data/fake-lambdas/hello.zip')),
    },
    FunctionName: randomId('messageConsumer'),
    Role: randomId('role'),
    Handler: 'index.handler',
    Runtime: 'nodejs14.x',
  }).promise();
  process.env.messageConsumer = lambda.FunctionName;

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

test.after.always(async (t) => {
  // cleanup table
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test.serial('disabling an SNS rule removes the event source mapping', async (t) => {
  const {
    snsTopicArn,
    testKnex,
  } = t.context;

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(item);

  t.is(ruleWithTrigger.rule.value, snsTopicArn);
  t.truthy(ruleWithTrigger.rule.arn);
  t.is(ruleWithTrigger.state, 'ENABLED');

  const updates = { ...ruleWithTrigger, state: 'DISABLED' };
  const ruleWithUpdatedTrigger = await rulesHelpers.updateRuleTrigger(
    ruleWithTrigger,
    updates,
    testKnex
  );

  t.is(ruleWithUpdatedTrigger.name, ruleWithTrigger.name);
  t.is(ruleWithUpdatedTrigger.state, 'DISABLED');
  t.is(ruleWithUpdatedTrigger.rule.type, ruleWithTrigger.rule.type);
  t.is(ruleWithUpdatedTrigger.rule.value, ruleWithTrigger.rule.value);
  t.falsy(ruleWithUpdatedTrigger.rule.arn);
});

test.serial('enabling a disabled SNS rule and passing rule.arn throws specific error', async (t) => {
  const {
    snsTopicArn,
    testKnex,
  } = t.context;

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'DISABLED',
  });

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(item);

  t.is(ruleWithTrigger.rule.value, snsTopicArn);
  t.falsy(ruleWithTrigger.rule.arn);
  t.is(ruleWithTrigger.state, 'DISABLED');

  const updates = {
    name: ruleWithTrigger.name,
    state: 'ENABLED',
    rule: {
      ...ruleWithTrigger.rule,
      arn: 'test-value',
    },
  };

  // Should fail because a disabled rule should not have an ARN
  // when being updated
  await t.throwsAsync(rulesHelpers.updateRuleTrigger(ruleWithTrigger, updates, testKnex), null,
    'Including rule.arn is not allowed when enabling a disabled rule');
});

test.serial('updating an SNS rule updates the event source mapping', async (t) => {
  const {
    snsTopicArn,
    testKnex,
  } = t.context;
  const { TopicArn: newSnsTopicArn } = await awsServices.sns().createTopic({ Name: randomId('sns') }).promise();

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(item);

  t.is(ruleWithTrigger.rule.value, snsTopicArn);

  const updates = { name: ruleWithTrigger.name, rule: { value: newSnsTopicArn } };
  const ruleWithUpdatedTrigger = await rulesHelpers.updateRuleTrigger(
    ruleWithTrigger,
    updates,
    testKnex
  );

  t.is(ruleWithUpdatedTrigger.name, ruleWithTrigger.name);
  t.is(ruleWithUpdatedTrigger.type, ruleWithTrigger.type);
  t.is(ruleWithUpdatedTrigger.rule.value, newSnsTopicArn);
  t.not(ruleWithUpdatedTrigger.rule.arn, ruleWithTrigger.rule.arn);
});

test.serial('deleting an SNS rule updates the event source mapping', async (t) => {
  const {
    snsTopicArn,
    testKnex,
  } = t.context;

  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'ENABLED',
  });

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(item);

  t.is(ruleWithTrigger.rule.value, snsTopicArn);

  await rulesHelpers.deleteRuleResources(testKnex, ruleWithTrigger);

  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: ruleWithTrigger.rule.arn,
  }));

  t.teardown(() => {
    unsubscribeSpy.restore();
  });
});

test.serial('deleteSnsTrigger throws more detailed ResourceNotFoundError', async (t) => {
  const errorMessage = 'Resource is not found in resource policy.';
  const error = new Error(errorMessage);
  error.code = 'ResourceNotFoundException';
  const { snsTopicArn } = t.context;
  const lambdaStub = sinon.stub(awsServices.lambda(), 'removePermission').throws(error);

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    workflow,
    state: 'ENABLED',
  }));

  await t.throwsAsync(
    rulesHelpers.deleteSnsTrigger(t.context.testKnex, ruleWithTrigger), {
      instanceOf: ResourceNotFoundError,
      message: `${errorMessage} ${resourceNotFoundInfo}`,
    }
  );

  t.teardown(() => {
    lambdaStub.restore();
  });
});
