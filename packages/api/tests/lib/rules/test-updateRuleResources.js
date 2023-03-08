'use strict';

const test = require('ava');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
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
const workflows = require('@cumulus/common/workflows');
const {
  destroyLocalTestDb,
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
const {
  createSqsQueues,
  fakeRuleFactoryV2,
} = require('../../../lib/testUtils');

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
  t.context.workflowFileKey = workflowFileKey;
  t.context.templateFileKey = templateFileKey;
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

test.serial('Updating a kinesis type rule workflow does not affect value or event source mappings', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const { testKnex } = t.context;
  const kinesisRule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'kinesis',
      value: kinesisArn,
    },
  });
  // create rule trigger
  const createdRule = await createRuleTrigger(kinesisRule);
  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);
  t.is(consumerEventMappings[0].UUID, createdRule.rule.arn);
  t.is(logEventMappings[0].UUID, createdRule.rule.logEventArn);

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
  t.is(updatedconsumerEventMappings[0].UUID, updatedRule.rule.arn);
  t.is(updatedlogEventMappings[0].UUID, updatedRule.rule.logEventArn);

  t.is(createdRule.rule.arn, updatedRule.rule.arn);
  t.is(createdRule.rule.logEventArn, updatedRule.rule.logEventArn);

  // Clean Up
  t.teardown(async () => {
    await deleteRuleResources(testKnex, createdRule);
    await deleteRuleResources(testKnex, updatedRule);
  });
});

test.serial('Updating a valid SQS rule to have an invalid schema throws an error', async (t) => {
  const queues = await createSqsQueues(randomString());
  const sqsRule = fakeRuleFactoryV2({
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
  const sqsRuleWithTrigger = await createRuleTrigger(sqsRule);
  t.is(sqsRuleWithTrigger.value, sqsRule.value);

  // update rule to be invalid by setting type to null
  const updatedSqsRule = {
    ...sqsRuleWithTrigger,
    rule: {
      ...sqsRuleWithTrigger.rule,
      type: null,
    },
  };
  await t.throwsAsync(
    updateRuleTrigger(sqsRuleWithTrigger, updatedSqsRule, t.context.testKnex),
    { name: 'SchemaValidationError' }
  );
  t.teardown(async () => {
    await deleteRuleResources(t.context.testKnex, sqsRuleWithTrigger);
    await SQS.deleteQueue(queues.queueUrl);
  });
});

test.serial('Updating an SQS rule fails if there is no redrive policy on the queue', async (t) => {
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
  const queueUrl = await SQS.createQueue(randomId('queue'));
  const updatedRule = {
    ...rule,
    rule: {
      ...rule.rule,
      value: queueUrl,
    },
  };
  await t.throwsAsync(
    updateRuleTrigger(sqsRule, updatedRule, t.context.testKnex),
    { message: `SQS queue ${queueUrl} does not have a dead-letter queue configured` }
  );
  t.teardown(async () => await SQS.deleteQueue(queueUrl));
});

test.serial('Updating the queue for an SQS rule succeeds', async (t) => {
  const queues = await createSqsQueues(randomString());
  const rule = fakeRuleFactoryV2({
    workflow,
    state: 'ENABLED',
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    meta: {
      visibilityTimeout: 100,
      retries: 4,
    },
  });
  const sqsRule = await createRuleTrigger(rule);
  t.deepEqual(sqsRule.rule.value, queues.queueUrl);

  const newQueues = await createSqsQueues(randomString());
  const updatedRule = {
    ...sqsRule,
    rule: {
      ...rule.rule,
      value: newQueues.queueUrl,
    },
  };
  const updatedSqsRule = await updateRuleTrigger(sqsRule, updatedRule, t.context.testKnex);
  t.is(updatedSqsRule.rule.value, newQueues.queueUrl);
  t.teardown(async () => {
    await SQS.deleteQueue(queues.queueUrl);
    await SQS.deleteQueue(newQueues.queueUrl);
  });
});

test.serial('Updating an SNS rule updates the event source mapping', async (t) => {
  const snsTopicArn = randomString();
  const newSnsTopicArn = randomString();
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: snsTopicArn,
  }).promise();
  const { TopicArn: TopicArn2 } = await awsServices.sns().createTopic({
    Name: newSnsTopicArn,
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

  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
  });

  const ruleWithTrigger = await createRuleTrigger(rule);

  t.is(ruleWithTrigger.rule.value, TopicArn);
  t.truthy(ruleWithTrigger.rule.arn);

  const updates = {
    ...rule,
    rule: {
      ...rule.rule,
      arn: ruleWithTrigger.rule.arn,
      value: TopicArn2,
    },
  };
  const updatedSnsRule = await updateRuleTrigger(ruleWithTrigger, updates, t.context.testKnex);

  t.is(updatedSnsRule.name, rule.name);
  t.is(updatedSnsRule.rule.type, rule.rule.type);
  t.is(updatedSnsRule.rule.value, TopicArn2);
  t.not(updatedSnsRule.rule.arn, rule.rule.arn);

  t.teardown(async () => {
    lambdaStub.restore();
    snsStub.restore();
    await awsServices.sns().deleteTopic({ TopicArn: TopicArn2 }).promise();
  });
});

test.serial('Updating an SNS rule to "disabled" removes the event source mapping ARN', async (t) => {
  const snsTopicArn = randomString();
  const { TopicArn } = await awsServices.sns().createTopic({
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

  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
  });

  const ruleWithTrigger = await createRuleTrigger(rule);

  t.is(ruleWithTrigger.rule.value, TopicArn);
  t.truthy(ruleWithTrigger.rule.arn);

  const updates = {
    ...ruleWithTrigger,
    state: 'DISABLED',
  };
  const updatedSnsRule = await updateRuleTrigger(ruleWithTrigger, updates, t.context.testKnex);

  t.true(Object.prototype.hasOwnProperty.call(updatedSnsRule.rule, 'arn'));
  t.is(updatedSnsRule.rule.arn, undefined);

  t.teardown(async () => {
    lambdaStub.restore();
    snsStub.restore();
    await awsServices.sns().deleteTopic({ TopicArn }).promise();
  });
});

test.serial('Enabling a disabled SNS rule and passing rule.arn throws specific error', async (t) => {
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

  const rule = fakeRuleFactoryV2({
    rule: {
      type: 'sns',
      value: snsTopicArn,
    },
    workflow,
    state: 'DISABLED',
  });

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
  await t.throwsAsync(updateRuleTrigger(rule, updates, t.context.testKnex),
    null,
    'Including rule.arn is not allowed when enabling a disabled rule');
  t.teardown(() => {
    snsStub.restore();
  });
});
