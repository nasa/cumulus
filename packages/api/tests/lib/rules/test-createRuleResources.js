'use strict';

const test = require('ava');
const sinon = require('sinon');
const omit = require('lodash/omit');
const { invoke } = require('@cumulus/aws-client/Lambda');
const awsServices = require('@cumulus/aws-client/services');
const SQS = require('@cumulus/aws-client/SQS');
const workflows = require('@cumulus/common/workflows');
const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const {
  randomId,
  randomString,
} = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  ProviderPgModel,
  RulePgModel,
} = require('@cumulus/db');
const {
  createRuleTrigger,
  buildPayload,
} = require('../../../lib/rulesHelpers');
const {
  createSqsQueues,
  fakeRuleFactoryV2,
} = require('../../../lib/testUtils');

const workflow = randomString();
const testDbName = randomString(12);

process.env.messageConsumer = randomString();
process.env.KinesisInboundEventLogger = randomString();
process.env.invoke = randomString();
const eventLambdas = [process.env.messageConsumer, process.env.KinesisInboundEventLogger];
const getKinesisEventMappings = async () => {
  const mappingPromises = eventLambdas.map((lambda) => {
    const mappingParms = { FunctionName: lambda };
    return awsServices.lambda().listEventSourceMappings(mappingParms).promise();
  });
  return await Promise.all(mappingPromises);
};

async function deleteKinesisEventSourceMappings() {
  const eventMappings = await getKinesisEventMappings();

  if (!eventMappings) {
    return Promise.resolve();
  }

  const allEventMappings = eventMappings[0].EventSourceMappings.concat(
    eventMappings[1].EventSourceMappings
  );

  return await Promise.all(allEventMappings.map((e) =>
    awsServices.lambda().deleteEventSourceMapping({ UUID: e.UUID }).promise()));
}

test.before(async (t) => {
  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;
  t.context.rulePgModel = new RulePgModel();

  await createBucket(process.env.system_bucket);

  const workflowFileKey = workflows.getWorkflowFileKey(process.env.stackName, workflow);
  const templateFileKey = workflows.templateKey(process.env.stackName);
  await Promise.all([
    putJsonS3Object(
      process.env.system_bucket,
      workflowFileKey,
      {}
    ),
    putJsonS3Object(
      process.env.system_bucket,
      templateFileKey,
      {}
    ),
  ]);
});

test.beforeEach(async () => {
  await deleteKinesisEventSourceMappings();
});

test.after.always(async (t) => {
  // cleanup table
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  delete process.env.system_bucket;
  delete process.env.stackName;
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('Creating a rule trigger defaults enabled to true', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    workflow,
  });
  // remove enabled from rule to be created
  delete rule.state;

  // create rule trigger
  const ruleWithTrigger = await createRuleTrigger(rule);

  t.is(ruleWithTrigger.state, 'ENABLED');
});

test('Creating an invalid rule does not create workflow triggers', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    workflow,
    state: 'ENABLED',
  });
  rule.rule.type = 'invalid';

  await t.throwsAsync(
    () => createRuleTrigger(rule),
    { name: 'ValidationError' }
  );
});

test('Creating a rule trigger for a onetime rule succeeds', async (t) => {
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'onetime',
    },
    state: 'ENABLED',
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });

  const invokeOneTimeSpy = sinon.spy(invoke);
  const onetimeRule = await createRuleTrigger(rule);

  t.true(invokeOneTimeSpy.called);
  t.deepEqual(onetimeRule, rule);
});

test('Creating a rule trigger for a onetime rule with a DISABLED state is DISABLED', async (t) => {
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'onetime',
    },
    state: 'DISABLED',
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });

  const invokeOneTimeSpy = sinon.spy(invoke);
  const onetimeRule = await createRuleTrigger(rule);

  t.false(invokeOneTimeSpy.called);
  t.deepEqual(onetimeRule.state, 'DISABLED');
});

test('Creating rule triggers for a kinesis type rule adds event mappings', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const kinesisRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'kinesis',
      value: kinesisArn,
    },
  });
  // create rule
  const createdRule = await createRuleTrigger(kinesisRule);
  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);
  t.is(consumerEventMappings[0].UUID, createdRule.rule.arn);
  t.is(logEventMappings[0].UUID, createdRule.rule.logEventArn);

  t.is(createdRule.name, kinesisRule.name);
  t.is(createdRule.rule.value, kinesisRule.rule.value);
  t.false(createdRule.rule.arn === undefined);
  t.false(createdRule.rule.logEventArn === undefined);

  // Clean Up
  await deleteKinesisEventSourceMappings();
});

test('Creating an invalid kinesis type rule does not add event mappings', async (t) => {
  const kinesisRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'kinesis',
      value: randomString(),
    },
  });
  delete kinesisRule.name;
  await t.throwsAsync(createRuleTrigger(kinesisRule), { name: 'SchemaValidationError' });

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 0);
  t.is(logEventMappings.length, 0);
});

test('Creating a rule trigger SQS rule fails if queue does not exist', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'sqs',
      value: 'non-existent-queue',
    },
    workflow,
    state: 'ENABLED',
  });
  await t.throwsAsync(
    createRuleTrigger(rule),
    { message: /SQS queue non-existent-queue does not exist/ }
  );
});

test('Creating a rule trigger for an SQS rule fails if there is no redrive policy on the queue', async (t) => {
  const queueUrl = await SQS.createQueue(randomId('queue'));
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queueUrl,
    },
    state: 'ENABLED',
  });
  await t.throwsAsync(
    createRuleTrigger(rule),
    { message: `SQS queue ${queueUrl} does not have a dead-letter queue configured` }
  );
  t.teardown(async () => await SQS.deleteQueue(queueUrl));
});

test('Creating a rule trigger for an SQS rule succeeds', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    state: 'ENABLED',
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });
  const sqsRule = await createRuleTrigger(rule);
  t.deepEqual(sqsRule, rule);
  t.teardown(async () => await SQS.deleteQueue(queues.queueUrl));
});

test('Creating a rule trigger for an SQS rule succeeds and sets default value for meta.retries and visibilityTimeout', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    state: 'ENABLED',
  });
  const sqsRule = await createRuleTrigger(rule);
  t.is(sqsRule.meta.retries, 3);
  t.is(sqsRule.meta.visibilityTimeout, 300);
  t.teardown(async () => await SQS.deleteQueue(queues.queueUrl));
});

test('Creating a rule trigger for a rule without a type fails', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    workflow,
    state: 'ENABLED',
  });
  delete rule.rule.type;

  await t.throwsAsync(
    () => createRuleTrigger(rule),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a rule trigger for a rule without a workflow fails', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    workflow,
    state: 'ENABLED',
  });
  delete rule.workflow;

  await t.throwsAsync(
    () => createRuleTrigger(rule),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a rule trigger for a rule without a name fails', async (t) => {
  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    workflow,
    state: 'ENABLED',
  });
  delete rule.name;

  await t.throwsAsync(
    () => createRuleTrigger(rule),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a disabled SNS rule creates no event source mapping', async (t) => {
  const snsTopicArn = randomString();
  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    state: 'DISABLED',
  });

  const rule = await createRuleTrigger(item);

  t.is(rule.state, 'DISABLED');
  t.is(rule.rule.value, snsTopicArn);
  t.falsy(rule.rule.arn);
});

test.serial('Creating an enabled SNS rule creates an event source mapping', async (t) => {
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: randomId('topic'),
  }).promise();

  const lambdaStub = sinon.stub(awsServices, 'lambda')
    .returns({
      addPermission: () => ({
        promise: () => Promise.resolve(),
      }),
      removePermission: () => ({
        promise: () => Promise.resolve(),
      }),
    });

  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => ({
        promise: () => Promise.resolve({
          Subscriptions: [{
            SubscriptionArn: randomString(),
          }],
        }),
      }),
      subscribe: () => ({
        promise: () => Promise.resolve({
          SubscriptionArn: randomString(),
        }),
      }),
    });

  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
  });
  const subscribeSpy = sinon.spy(awsServices.sns(), 'subscribe');
  const addPermissionSpy = sinon.spy(awsServices.lambda(), 'addPermission');

  await createRuleTrigger(rule);
  t.true(subscribeSpy.called);
  t.true(subscribeSpy.calledWith({
    TopicArn: rule.rule.value,
    Protocol: 'lambda',
    Endpoint: process.env.messageConsumer,
    ReturnSubscriptionArn: true,
  }));
  t.true(addPermissionSpy.called);
  t.teardown(async () => {
    lambdaStub.restore();
    snsStub.restore();
    subscribeSpy.restore();
    addPermissionSpy.restore();
    await awsServices.sns().deleteTopic({ TopicArn }).promise();
  });
});

test.serial('Creating a rule trigger for a scheduled rule succeeds', async (t) => {
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'scheduled',
      value: 'rate(1 min)',
    },
    state: 'ENABLED',
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });

  const cloudwatchStub = sinon.stub(awsServices, 'cloudwatchevents')
    .returns({
      putRule: () => ({
        promise: () => Promise.resolve(),
      }),
      putTargets: () => ({
        promise: () => Promise.resolve(),
      }),
    });
  const scheduledRule = await createRuleTrigger(rule);
  t.true(cloudwatchStub.called);
  t.deepEqual(scheduledRule, rule);
  t.teardown(() => {
    cloudwatchStub.restore();
  });
});

test('buildPayload builds a lambda payload from the rule', async (t) => {
  const collectionPgModel = new CollectionPgModel();
  const providerPgModel = new ProviderPgModel();
  const testPgProvider = fakeProviderRecordFactory();
  const [pgProvider] = await providerPgModel.create(
    t.context.testKnex,
    testPgProvider,
    '*'
  );
  const collectionName = 'fakeCollection';
  const collectionVersion = 'v1';
  const testPgCollection = fakeCollectionRecordFactory({
    name: collectionName,
    version: collectionVersion,
  });
  const [pgCollection] = await collectionPgModel.create(
    t.context.testKnex,
    testPgCollection
  );
  const ruleParams = {
    rule: { type: 'onetime' },
    workflow,
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
    cumulus_meta: {
      execution_name: 'fakeName',
    },
    payload: {
      input: 'test',
    },
    queueUrl: randomString(),
    executionNamePrefix: randomString(),
    asyncOperationId: randomString(),
    provider: pgProvider.name,
    collection: { name: pgCollection.name, version: pgCollection.version },
  };
  const rule = fakeRuleFactoryV2(ruleParams);
  const expectedPayload = {
    provider: pgProvider.name,
    collection: { name: pgCollection.name, version: pgCollection.version },
    meta: rule.meta,
    cumulus_meta: { execution_name: rule.cumulus_meta.execution_name },
    payload: rule.payload,
    queueUrl: rule.queueUrl,
    executionNamePrefix: rule.executionNamePrefix,
    asyncOperationId: rule.asyncOperationId,
  };
  const payload = await buildPayload(rule, ruleParams.cumulus_meta, ruleParams.asyncOperationId);
  t.deepEqual(omit(payload, ['template', 'definition']), expectedPayload);
});

test('buildPayload throws error if workflow file does not exist', async (t) => {
  const fakeWorkflow = randomString();
  const workflowFileKey = workflows.getWorkflowFileKey(process.env.stackName, fakeWorkflow);
  const ruleParams = {
    rule: { type: 'onetime' },
    workflow: fakeWorkflow,
  };
  const rule = fakeRuleFactoryV2(ruleParams);
  await t.throwsAsync(
    buildPayload(rule),
    { message: `Workflow doesn\'t exist: s3://${process.env.system_bucket}/${workflowFileKey} for ${rule.name}` }
  );
});
