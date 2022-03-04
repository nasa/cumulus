'use strict';

const test = require('ava');
const sinon = require('sinon');
const omit = require('lodash/omit');

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
  fakeRuleRecordFactory,
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
const { createSqsQueues } = require('../../../lib/testUtils');

const workflow = randomString();
const testDbName = randomString(12);

process.env.messageConsumer = randomString();
process.env.KinesisInboundEventLogger = randomString();
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
  const rule = fakeRuleRecordFactory({
    type: 'onetime',
    workflow,
    enabled: true,
  });
  // remove enabled from rule to be created
  delete rule.enabled;

  // create rule trigger
  const ruleWithTrigger = await createRuleTrigger(rule, t.context.testKnex);

  t.true(ruleWithTrigger.enabled);
});

test('Creating an invalid rule does not create workflow triggers', async (t) => {
  const rule = fakeRuleRecordFactory({
    type: 'onetime',
    workflow,
    enabled: true,
  });
  rule.type = 'invalid';

  await t.throwsAsync(
    () => createRuleTrigger(rule, t.context.testKnex),
    { name: 'ValidationError' }
  );
});

test('Creating rule triggers for a kinesis type rule adds event mappings', async (t) => {
  const kinesisRule = fakeRuleRecordFactory({
    type: 'kinesis',
    workflow,
    enabled: true,
    value: randomString(),
  });
  // create rule
  const createdRule = await createRuleTrigger(kinesisRule, t.context.testKnex);
  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);
  t.is(consumerEventMappings[0].UUID, createdRule.arn);
  t.is(logEventMappings[0].UUID, createdRule.log_event_arn);

  t.is(createdRule.name, kinesisRule.name);
  t.is(createdRule.value, kinesisRule.value);
  t.false(createdRule.arn === undefined);
  t.false(createdRule.log_event_arn === undefined);

  // Clean Up
  await deleteKinesisEventSourceMappings();
});

test('Creating an invalid kinesis type rule does not add event mappings', async (t) => {
  const kinesisRule = fakeRuleRecordFactory({
    type: 'kinesis',
    workflow,
    enabled: true,
    value: randomString(),
  });
  delete kinesisRule.name;
  await t.throwsAsync(createRuleTrigger(kinesisRule, t.context.testKnex), { name: 'SchemaValidationError' });

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 0);
  t.is(logEventMappings.length, 0);
});

test('Creating a rule trigger SQS rule fails if queue does not exist', async (t) => {
  const rule = fakeRuleRecordFactory({
    workflow,
    type: 'sqs',
    value: 'non-existent-queue',
    enabled: true,
  });
  await t.throwsAsync(
    createRuleTrigger(rule, t.context.testKnex),
    { message: /SQS queue non-existent-queue does not exist/ }
  );
});

test('Creating a rule trigger for an SQS rule fails if there is no redrive policy on the queue', async (t) => {
  const queueUrl = await SQS.createQueue(randomId('queue'));
  const rule = fakeRuleRecordFactory({
    workflow,
    type: 'sqs',
    value: queueUrl,
    enabled: true,
  });
  await t.throwsAsync(
    createRuleTrigger(rule, t.context.testKnex),
    { message: `SQS queue ${queueUrl} does not have a dead-letter queue configured` }
  );
  t.teardown(async () => await SQS.deleteQueue(queueUrl));
});

test('Creating a rule trigger for an SQS rule succeeds', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleRecordFactory({
    workflow,
    type: 'sqs',
    value: queues.queueUrl,
    enabled: true,
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });
  const sqsRule = await createRuleTrigger(rule, t.context.testKnex);
  t.deepEqual(sqsRule, rule);
  t.teardown(async () => await SQS.deleteQueue(queues.queueUrl));
});

test('Creating a rule trigger for an SQS rule succeeds and sets default value for meta.retries and visibilityTimeout', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleRecordFactory({
    workflow,
    type: 'sqs',
    value: queues.queueUrl,
    enabled: true,
  });
  const sqsRule = await createRuleTrigger(rule, t.context.testKnex);
  t.is(sqsRule.meta.retries, 3);
  t.is(sqsRule.meta.visibilityTimeout, 300);
  t.teardown(async () => await SQS.deleteQueue(queues.queueUrl));
});

test('Creating a rule trigger for a rule without a type fails', async (t) => {
  const rule = fakeRuleRecordFactory({
    type: 'onetime',
    workflow,
    enabled: true,
  });
  delete rule.type;

  await t.throwsAsync(
    () => createRuleTrigger(rule, t.context.testKnex),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a rule trigger for a rule without a workflow fails', async (t) => {
  const rule = fakeRuleRecordFactory({
    type: 'onetime',
    workflow,
    enabled: true,
  });
  delete rule.workflow;

  await t.throwsAsync(
    () => createRuleTrigger(rule, t.context.testKnex),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a rule trigger for a rule without a name fails', async (t) => {
  const rule = fakeRuleRecordFactory({
    type: 'onetime',
    workflow,
    enabled: true,
  });
  delete rule.name;

  await t.throwsAsync(
    () => createRuleTrigger(rule, t.context.testKnex),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a disabled SNS rule creates no event source mapping', async (t) => {
  const snsTopicArn = randomString();
  const item = fakeRuleRecordFactory({
    workflow,
    type: 'sns',
    value: snsTopicArn,
    enabled: false,
  });

  const rule = await createRuleTrigger(item, t.context.testKnex);

  t.is(rule.enabled, false);
  t.is(rule.value, snsTopicArn);
  t.falsy(rule.arn);
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

  const rule = fakeRuleRecordFactory({
    type: 'sns',
    value: TopicArn,
    workflow,
    enabled: true,
  });
  const subscribeSpy = sinon.spy(awsServices.sns(), 'subscribe');
  const addPermissionSpy = sinon.spy(awsServices.lambda(), 'addPermission');

  await createRuleTrigger(rule, t.context.testKnex);
  t.true(subscribeSpy.called);
  t.true(subscribeSpy.calledWith({
    TopicArn: rule.value,
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
    type: 'onetime',
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
    execution_name_prefix: randomString(),
    asyncOperationId: 1,
    provider_cumulus_id: pgProvider.cumulus_id,
    collection_cumulus_id: pgCollection.cumulus_id,
  };
  const rule = fakeRuleRecordFactory(ruleParams);
  const expectedPayload = {
    provider: pgProvider.name,
    collection: { name: pgCollection.name, version: pgCollection.version },
    meta: rule.meta,
    cumulus_meta: { execution_name: rule.cumulus_meta.execution_name },
    payload: rule.payload,
    queueUrl: rule.queue_url,
    executionNamePrefix: rule.execution_name_prefix,
    asyncOperationId: rule.asyncOperationId,
  };
  const payload = await buildPayload(rule, t.context.testKnex);
  t.deepEqual(omit(payload, ['template', 'definition']), expectedPayload);
});

test('buildPayload throws error if workflow file does not exist', async (t) => {
  const fakeWorkflow = randomString();
  const workflowFileKey = workflows.getWorkflowFileKey(process.env.stackName, fakeWorkflow);
  const ruleParams = {
    type: 'onetime',
    workflow: fakeWorkflow,
  };
  const rule = fakeRuleRecordFactory(ruleParams);
  await t.throwsAsync(
    buildPayload(rule, t.context.testKnex),
    { message: `Workflow doesn\'t exist: s3://${process.env.system_bucket}/${workflowFileKey} for ${rule.name}` }
  );
});
