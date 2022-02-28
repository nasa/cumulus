'use strict';

const test = require('ava');

const awsServices = require('@cumulus/aws-client/services');
const sinon = require('sinon');
const SQS = require('@cumulus/aws-client/SQS');
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
  destroyLocalTestDb,
  fakeRuleRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  RulePgModel,
} = require('@cumulus/db');
const {
  createRuleTrigger,
  updateRuleTrigger,
  deleteRuleResources,
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

test.serial('Updating rule triggers for a kinesis type rule updates event mappings', async (t) => {
  const { testKnex } = t.context;
  const kinesisRule = fakeRuleRecordFactory({
    type: 'kinesis',
    workflow,
    enabled: true,
    value: randomString(),
  });
  // create rule trigger
  const createdRule = await createRuleTrigger(kinesisRule);
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

  // update rule
  const updatedKinesisRule = {
    ...createdRule,
    value: 'new-value',
  };
  const updatedRule = await updateRuleTrigger(kinesisRule, updatedKinesisRule, testKnex);
  const updatedKinesisEventMappings = await getKinesisEventMappings();
  const updatedconsumerEventMappings = updatedKinesisEventMappings[0].EventSourceMappings;
  const updatedlogEventMappings = updatedKinesisEventMappings[1].EventSourceMappings;

  t.is(updatedconsumerEventMappings.length, 1);
  t.is(updatedlogEventMappings.length, 1);
  t.is(updatedconsumerEventMappings[0].UUID, updatedRule.arn);
  t.is(updatedlogEventMappings[0].UUID, updatedRule.log_event_arn);

  // Clean Up
  t.teardown(async () => {
    await deleteRuleResources(testKnex, createdRule);
    await deleteRuleResources(testKnex, updatedRule);
  });
});

test('Updating a kinesis type rule value updates event mappings', async (t) => {
  const { testKnex } = t.context;
  const kinesisRule = fakeRuleRecordFactory({
    type: 'kinesis',
    workflow,
    enabled: true,
    value: randomString(),
  });
  // create rule
  const createdRule = await createRuleTrigger(kinesisRule);

  // update rule value
  const updatedKinesisRule = {
    ...createdRule,
    value: 'new-value',
  };
  delete updatedKinesisRule.name;
  const updatedRuleWithTrigger = await updateRuleTrigger(kinesisRule, updatedKinesisRule, testKnex);
  const updatedKinesisEventMappings = await getKinesisEventMappings();
  const updatedconsumerEventMappings = updatedKinesisEventMappings[0].EventSourceMappings;
  const updatedlogEventMappings = updatedKinesisEventMappings[1].EventSourceMappings;

  t.is(updatedconsumerEventMappings.length, 1);
  t.is(updatedlogEventMappings.length, 1);
  t.is(updatedconsumerEventMappings[0].UUID, updatedRuleWithTrigger.arn);
  t.is(updatedlogEventMappings[0].UUID, updatedRuleWithTrigger.log_event_arn);

  t.false(createdRule.arn === updatedRuleWithTrigger.arn);
  t.false(createdRule.log_event_arn === updatedRuleWithTrigger.log_event_arn);

  // Clean Up
  t.teardown(async () => {
    await deleteRuleResources(testKnex, createdRule);
    await deleteRuleResources(testKnex, updatedRuleWithTrigger);
  });
});

test.serial('Updating a kinesis type rule to disabled does not change event source mappings', async (t) => {
  const { testKnex } = t.context;
  const kinesisRule = fakeRuleRecordFactory({
    type: 'kinesis',
    workflow,
    enabled: true,
    value: randomString(),
  });
  // create rule trigger
  const createdRule = await createRuleTrigger(kinesisRule);
  t.false(createdRule.arn === undefined);
  t.false(createdRule.log_event_arn === undefined);

  // update rule state by setting enabled to false
  const updatedKinesisRule = {
    ...createdRule,
    enabled: false,
  };
  const updatedRule = await updateRuleTrigger(kinesisRule, updatedKinesisRule, testKnex);
  t.false(updatedRule.enabled);

  const updatedKinesisEventMappings = await getKinesisEventMappings();
  const updatedconsumerEventMappings = updatedKinesisEventMappings[0].EventSourceMappings;
  const updatedlogEventMappings = updatedKinesisEventMappings[1].EventSourceMappings;

  t.is(updatedconsumerEventMappings.length, 1);
  t.is(updatedlogEventMappings.length, 1);
  t.is(updatedconsumerEventMappings[0].UUID, updatedRule.arn);
  t.is(updatedlogEventMappings[0].UUID, updatedRule.log_event_arn);

  t.is(createdRule.arn, updatedRule.arn);
  t.is(createdRule.log_event_arn, updatedRule.log_event_arn);

  // Clean Up
  t.teardown(async () => {
    await deleteRuleResources(testKnex, createdRule);
    await deleteRuleResources(testKnex, updatedRule);
  });
});

test.serial('Updating a kinesis type rule workflow does not affect value or event source mappings', async (t) => {
  const { testKnex } = t.context;
  const kinesisRule = fakeRuleRecordFactory({
    type: 'kinesis',
    workflow,
    enabled: true,
    value: randomString(),
  });
  // create rule trigger
  const createdRule = await createRuleTrigger(kinesisRule);
  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);
  t.is(consumerEventMappings[0].UUID, createdRule.arn);
  t.is(logEventMappings[0].UUID, createdRule.log_event_arn);

  // update rule workflow
  const updatedKinesisRule = {
    ...createdRule,
    workflow: 'new-workflow',
  };
  const updatedRule = await updateRuleTrigger(kinesisRule, updatedKinesisRule, testKnex);
  const updatedKinesisEventMappings = await getKinesisEventMappings();
  const updatedconsumerEventMappings = updatedKinesisEventMappings[0].EventSourceMappings;
  const updatedlogEventMappings = updatedKinesisEventMappings[1].EventSourceMappings;

  t.is(updatedconsumerEventMappings.length, 1);
  t.is(updatedlogEventMappings.length, 1);
  t.is(updatedconsumerEventMappings[0].UUID, updatedRule.arn);
  t.is(updatedlogEventMappings[0].UUID, updatedRule.log_event_arn);

  t.is(createdRule.arn, updatedRule.arn);
  t.is(createdRule.log_event_arn, updatedRule.log_event_arn);

  // Clean Up
  t.teardown(async () => {
    await deleteRuleResources(testKnex, createdRule);
    await deleteRuleResources(testKnex, updatedRule);
  });
});

test.serial('Updating a valid rule to have an invalid schema throws an error and does not update triggers', async (t) => {
  const queues = await createSqsQueues(randomString());
  const sqsRule = fakeRuleRecordFactory({
    workflow,
    type: 'sqs',
    value: queues.queueUrl,
    enabled: true,
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });
  const sqsRuleWithTrigger = await createRuleTrigger(sqsRule);
  t.is(sqsRuleWithTrigger.value, sqsRule.value);

  // update rule to be invalid by setting type to null
  const updatedKinesisRule = {
    ...sqsRuleWithTrigger,
    type: null,
  };
  await t.throwsAsync(
    updateRuleTrigger(sqsRuleWithTrigger, updatedKinesisRule, t.context.testKnex),
    { name: 'SchemaValidationError' }
  );
  const updatedKinesisEventMappings = await getKinesisEventMappings();
  const updatedConsumerEventMappings = updatedKinesisEventMappings[0].EventSourceMappings;
  const updatedLogEventMappings = updatedKinesisEventMappings[1].EventSourceMappings;

  t.is(updatedConsumerEventMappings.length, 0);
  t.is(updatedLogEventMappings.length, 0);
  t.teardown(async () => {
    await deleteRuleResources(t.context.testKnex, sqsRuleWithTrigger);
    await SQS.deleteQueue(queues.queueUrl);
  });
});

test.serial('Updating a rule trigger for an SQS rule fails if there is no redrive policy on the queue', async (t) => {
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
  const sqsRule = await createRuleTrigger(rule);
  const queueUrl = await SQS.createQueue(randomId('queue'));
  const updatedRule = {
    ...rule,
    value: queueUrl,
  };
  await t.throwsAsync(
    updateRuleTrigger(sqsRule, updatedRule, t.context.testKnex),
    { message: `SQS queue ${queueUrl} does not have a dead-letter queue configured` }
  );
  t.teardown(async () => await SQS.deleteQueue(queueUrl));
});

test.serial('Updating a rule trigger for an SQS rule succeeds', async (t) => {
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
  const sqsRule = await createRuleTrigger(rule);
  t.deepEqual(sqsRule.value, queues.queueUrl);

  const newQueues = await createSqsQueues(randomString());
  const updatedRule = {
    ...sqsRule,
    value: newQueues.queueUrl,
  };
  const updatedSqsRule = await updateRuleTrigger(sqsRule, updatedRule, t.context.testKnex);
  t.deepEqual(updatedSqsRule.value, newQueues.queueUrl);
  t.teardown(async () => {
    await SQS.deleteQueue(queues.queueUrl);
    await SQS.deleteQueue(newQueues.queueUrl);
  });
});

test.serial('Updating an SNS rule updates the event source mapping', async (t) => {
  const snsTopicArn = randomString();
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: snsTopicArn,
  }).promise();
  const { TopicArn: TopicArn2 } = await awsServices.sns().createTopic({
    Name: snsTopicArn,
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
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        }),
      }),
      unsubscribe: () => ({
        promise: () => Promise.resolve(),
      }),
    });

  const rule = fakeRuleRecordFactory({
    type: 'sns',
    value: TopicArn,
    workflow,
    enabled: true,
  });

  const ruleWithTrigger = await createRuleTrigger(rule);

  t.is(rule.value, TopicArn);

  const updates = {
    name: rule.name,
    value: TopicArn2,
    type: 'sns',
  };
  const updatedSqsRule = await updateRuleTrigger(ruleWithTrigger, updates, t.context.testKnex);

  t.is(updatedSqsRule.name, rule.name);
  t.is(updatedSqsRule.type, rule.type);
  t.is(updatedSqsRule.value, TopicArn2);
  t.not(updatedSqsRule.arn, rule.arn);

  t.teardown(async () => {
    lambdaStub.restore();
    snsStub.restore();
    await awsServices.sns().deleteTopic({ TopicArn: TopicArn2 }).promise();
  });
});
