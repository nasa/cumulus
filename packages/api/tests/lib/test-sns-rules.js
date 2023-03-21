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
  fakeProviderRecordFactory,
  fakeCollectionRecordFactory,
  ProviderPgModel,
  CollectionPgModel,
  translateApiRuleToPostgresRule,
} = require('@cumulus/db');
const { randomId, randomString } = require('@cumulus/common/test-utils');

const rulesHelpers = require('../../lib/rulesHelpers');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');
const { ResourceNotFoundError, resourceNotFoundInfo } = require('../../lib/errors');

const workflow = randomString();
const testDbName = randomString(12);

test.before(async (t) => {
  process.env.stackName = randomString();
  process.env.KinesisInboundEventLogger = randomString();
  process.env.system_bucket = randomString();

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;
  t.context.rulePgModel = new RulePgModel();
  t.context.providerPgModel = new ProviderPgModel();
  t.context.collectionPgModel = new CollectionPgModel();

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

test.serial('Multiple rules using same SNS topic can be created and deleted', async (t) => {
  const {
    collectionPgModel,
    providerPgModel,
    testKnex,
    rulePgModel,
  } = t.context;
  const testPgProvider = fakeProviderRecordFactory();
  await providerPgModel.create(
    testKnex,
    testPgProvider,
    '*'
  );

  const testPgCollection1 = fakeCollectionRecordFactory({
    name: randomId('collection-'),
    version: 'v1',
  });
  const testPgCollection2 = fakeCollectionRecordFactory({
    name: randomId('collection-'),
    version: 'v2',
  });
  await Promise.all([
    collectionPgModel.create(
      testKnex,
      testPgCollection1,
      '*'
    ),
    collectionPgModel.create(
      testKnex,
      testPgCollection2,
      '*'
    ),
  ]);
  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: randomId('topic'),
  }).promise();

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(fakeRuleFactoryV2({
    name: randomId('rule1'),
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
    collection: {
      name: testPgCollection1.name,
      version: testPgCollection1.version,
    },
    provider: testPgProvider.name,
  }));
  const ruleWithTrigger2 = await rulesHelpers.createRuleTrigger(fakeRuleFactoryV2({
    name: randomId('rule2'),
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
    collection: {
      name: testPgCollection2.name,
      version: testPgCollection2.version,
    },
    provider: testPgProvider.name,
  }));

  const pgRule = await translateApiRuleToPostgresRule(ruleWithTrigger, testKnex);
  const pgRule2 = await translateApiRuleToPostgresRule(ruleWithTrigger2, testKnex);

  const [rule1] = await rulePgModel.create(testKnex, pgRule);
  const [rule2] = await rulePgModel.create(testKnex, pgRule2);

  // rules share the same subscription
  t.is(rule1.arn, rule2.arn);

  // Have to delete rules serially otherwise all rules still exist
  // when logic to check for shared source mapping is evaluated

  await rulesHelpers.deleteSnsTrigger(testKnex, ruleWithTrigger);
  await rulePgModel.delete(testKnex, rule1);

  await t.notThrowsAsync(rulesHelpers.deleteSnsTrigger(testKnex, ruleWithTrigger2));
  await rulePgModel.delete(testKnex, rule2);

  // Ensure that cleanup for SNS rule subscription was actually called
  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: ruleWithTrigger.rule.arn,
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
