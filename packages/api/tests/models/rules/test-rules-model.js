'use strict';

const test = require('ava');
const sinon = require('sinon');
const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');
const cryptoRandomString = require('crypto-random-string');

const awsServices = require('@cumulus/aws-client/services');
const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const SQS = require('@cumulus/aws-client/SQS');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const { ValidationError } = require('@cumulus/errors');

const models = require('../../../models');
const { createSqsQueues, fakeRuleFactoryV2 } = require('../../../lib/testUtils');

process.env.RulesTable = `RulesTable_${randomString()}`;
process.env.stackName = randomString();
process.env.messageConsumer = randomString();
process.env.KinesisInboundEventLogger = randomString();
process.env.system_bucket = randomString();

const workflow = randomString();
const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
const templateFile = `${process.env.stackName}/workflow_template.json`;

async function getKinesisEventMappings() {
  const eventLambdas = [process.env.messageConsumer, process.env.KinesisInboundEventLogger];

  const mappingPromises = eventLambdas.map((lambda) => {
    const mappingParms = { FunctionName: lambda };
    return awsServices.lambda().listEventSourceMappings(mappingParms).promise();
  });
  return Promise.all(mappingPromises);
}

async function deleteKinesisEventSourceMappings() {
  const eventMappings = await getKinesisEventMappings();

  if (!eventMappings) {
    return Promise.resolve();
  }

  const allEventMappings = eventMappings[0].EventSourceMappings.concat(
    eventMappings[1].EventSourceMappings
  );

  return Promise.all(allEventMappings.map((e) =>
    awsServices.lambda().deleteEventSourceMapping({ UUID: e.UUID }).promise()));
}

let rulesModel;

test.before(async () => {
  // create Rules table
  rulesModel = new models.Rule();
  await rulesModel.createTable();
  await createBucket(process.env.system_bucket);
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
  t.context.onetimeRule = {
    name: randomString(),
    workflow,
    provider: 'my-provider',
    collection: {
      name: 'my-collection-name',
      version: 'my-collection-version',
    },
    rule: {
      type: 'onetime',
    },
    state: 'ENABLED',
  };

  t.context.kinesisRule = {
    name: randomString(),
    workflow,
    provider: 'my-provider',
    collection: {
      name: 'my-collection-name',
      version: 'my-collection-version',
    },
    rule: {
      type: 'kinesis',
      value: 'my-kinesis-arn',
    },
    state: 'ENABLED',
  };
});

test.after.always(async () => {
  // cleanup table
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('create defaults rule state to ENABLED', async (t) => {
  const { onetimeRule } = t.context;

  // remove state from rule to be created
  delete onetimeRule.state;

  // create rule
  const rule = await rulesModel.create(onetimeRule);

  t.is(rule.state, 'ENABLED');

  // delete rule
  await rulesModel.delete(rule);
});

test('create and delete a onetime rule', async (t) => {
  const { onetimeRule } = t.context;

  // create rule
  const rule = await rulesModel.create(onetimeRule);

  t.is(rule.name, onetimeRule.name);

  // delete rule
  await rulesModel.delete(rule);
  t.false(await rulesModel.exists({ name: rule.name }));
});

test('Creating a rule with an invalid name throws an error', async (t) => {
  const { onetimeRule } = t.context;
  const ruleItem = cloneDeep(onetimeRule);

  ruleItem.name = 'bad rule name';

  await t.throwsAsync(
    () => rulesModel.create(ruleItem),
    {
      instanceOf: ValidationError,
      message: 'Rule name may only contain letters, numbers, and underscores.',
    }
  );
});

test('Creating a rule with an undefined type throws an error', async (t) => {
  const { onetimeRule } = t.context;
  const ruleItem = cloneDeep(onetimeRule);

  ruleItem.rule.type = undefined;

  await t.throwsAsync(
    () => rulesModel.create(ruleItem),
    { name: 'SchemaValidationError' }
  );
});

test('Creating a rule with an invalid type throws an error', async (t) => {
  const { onetimeRule } = t.context;

  onetimeRule.rule.type = 'invalid';

  await t.throwsAsync(
    () => rulesModel.create(onetimeRule),
    { name: 'SchemaValidationError' }
  );
});

test.serial('Creating an invalid rule does not create workflow triggers', async (t) => {
  const { onetimeRule } = t.context;
  const ruleItem = cloneDeep(onetimeRule);

  ruleItem.rule.type = 'invalid';

  const createTriggerStub = sinon.stub(models.Rule.prototype, 'createRuleTrigger').resolves(ruleItem);

  try {
    await t.throwsAsync(
      () => rulesModel.create(ruleItem),
      { name: 'SchemaValidationError' }
    );
    t.true(createTriggerStub.notCalled);
  } finally {
    createTriggerStub.restore();
  }
});

test('enabling a disabled rule updates the state', async (t) => {
  const { onetimeRule } = t.context;

  const ruleItem = cloneDeep(onetimeRule);
  ruleItem.state = 'DISABLED';

  const rule = await rulesModel.create(ruleItem);

  t.is(rule.state, 'DISABLED');

  const updates = { name: rule.name, state: 'ENABLED' };
  const updatedRule = await rulesModel.update(rule, updates);

  t.is(updatedRule.name, rule.name);
  t.is(updatedRule.type, rule.type);
  t.is(updatedRule.state, 'ENABLED');

  await rulesModel.delete(rule);
});

test.serial('Updating a valid rule to have an invalid schema throws an error and does not update triggers', async (t) => {
  const { onetimeRule } = t.context;

  const rule = await rulesModel.create(onetimeRule);

  const updates = { name: rule.name, rule: null };

  const updateTriggerStub = sinon.stub(models.Rule.prototype, 'updateRuleTrigger').resolves(rule);

  try {
    await t.throwsAsync(
      () => rulesModel.update(rule, updates),
      { name: 'SchemaValidationError' }
    );

    t.true(updateTriggerStub.notCalled);
  } finally {
    updateTriggerStub.restore();
  }
});

test.serial('create a kinesis type rule adds event mappings, creates rule', async (t) => {
  const { kinesisRule } = t.context;

  // create rule
  const createdRule = await rulesModel.create(kinesisRule);
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

  // clean up
  await rulesModel.delete(createdRule);
  await deleteKinesisEventSourceMappings();
});

test.serial('deleting a kinesis style rule removes event mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create and delete rule
  const createdRule = await rulesModel.create(kinesisRule);
  t.true(await rulesModel.exists({ name: createdRule.name }));

  await rulesModel.delete(createdRule);

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 0);
  t.is(logEventMappings.length, 0);
});

test.serial('update a kinesis type rule state, event source mappings do not change', async (t) => {
  const { kinesisRule } = t.context;

  // create rule
  await rulesModel.create(kinesisRule);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  // update rule state
  const updates = { name: rule.name, state: 'ENABLED' };
  const updatedRule = await rulesModel.update(rule, updates);

  t.is(updatedRule.state, 'ENABLED');

  // Event source mapping references don't change
  t.is(updatedRule.rule.arn, rule.rule.arn);
  t.is(updatedRule.rule.logEventArn, rule.rule.logEventArn);

  // clean up
  await rulesModel.delete(rule);
  await deleteKinesisEventSourceMappings();
});

test.serial('update a kinesis type rule value, resulting in new event source mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create rule
  await rulesModel.create(kinesisRule);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  // update rule value
  const updates = {
    name: rule.name,
    rule: { type: rule.rule.type, value: 'my-new-kinesis-arn' },
  };

  const updatedRule = await rulesModel.update(rule, updates);

  t.is(updatedRule.name, rule.name);
  t.not(updatedRule.rule.value, rule.rule.value);

  // Event source mappings exist and have been updated
  t.truthy(updatedRule.rule.arn);
  t.not(updatedRule.rule.arn, rule.rule.arn);
  t.truthy(updatedRule.rule.logEventArn);
  t.not(updatedRule.rule.logEventArn, rule.rule.logEventArn);

  await rulesModel.delete(rule);
  await deleteKinesisEventSourceMappings();
});

test.serial('update a kinesis type rule workflow does not affect value or event source mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create rule
  await rulesModel.create(kinesisRule);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  // update rule value
  const updates = {
    name: rule.name,
    workflow: 'new-workflow',
  };

  const updatedRule = await rulesModel.update(rule, updates);

  t.is(updatedRule.name, rule.name);
  t.is(updatedRule.rule.value, rule.rule.value);

  // Event source mappings exist and have been updated
  t.truthy(updatedRule.rule.arn);
  t.is(updatedRule.rule.arn, rule.rule.arn);
  t.truthy(updatedRule.rule.logEventArn);
  t.is(updatedRule.rule.logEventArn, rule.rule.logEventArn);

  await rulesModel.delete(rule);
  await deleteKinesisEventSourceMappings();
});

test.serial('create a kinesis type rule, using existing event source mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create two rules with same value
  const newKinesisRule = cloneDeep(kinesisRule);
  newKinesisRule.name = `${kinesisRule.name}_new`;

  await rulesModel.create(kinesisRule);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  await rulesModel.create(newKinesisRule);
  const newRule = await rulesModel.get({ name: newKinesisRule.name });

  t.not(newRule.name, rule.name);
  t.is(newRule.rule.value, rule.rule.value);
  t.false(newRule.rule.arn === undefined);
  t.false(newRule.rule.logEventArn === undefined);
  // Event source mappings have not changed
  t.is(newRule.rule.arn, rule.rule.arn);
  t.is(newRule.rule.logEventArn, rule.rule.logEventArn);

  await rulesModel.delete(rule);
  await rulesModel.delete(newRule);
  await deleteKinesisEventSourceMappings();
});

test.serial('it does not delete event source mappings if they exist for other rules', async (t) => {
  const { kinesisRule } = t.context;

  // we have three rules to create
  const kinesisRuleTwo = cloneDeep(kinesisRule);
  kinesisRuleTwo.name = `${kinesisRule.name}_two`;

  const kinesisRuleThree = cloneDeep(kinesisRule);
  kinesisRuleThree.name = `${kinesisRule.name}_three`;

  // create two rules with same value
  await rulesModel.create(kinesisRule);
  const rule = await rulesModel.get({ name: kinesisRule.name });
  await rulesModel.create(kinesisRuleTwo);
  const ruleTwo = await rulesModel.get({ name: kinesisRuleTwo.name });

  // same event source mapping
  t.is(ruleTwo.rule.arn, rule.rule.arn);
  t.is(ruleTwo.rule.logEventArn, rule.rule.logEventArn);

  // delete the second rule, it should not delete the event source mapping
  await rulesModel.delete(ruleTwo);

  // create third rule, it should use the existing event source mapping
  await rulesModel.create(kinesisRuleThree);
  const ruleThree = await rulesModel.get({ name: kinesisRuleThree.name });
  t.is(ruleThree.rule.arn, rule.rule.arn);
  t.is(ruleThree.rule.logEventArn, rule.rule.logEventArn);

  // Cleanup -- this is required for repeated local testing, else localstack retains rules
  await rulesModel.delete(rule);
  await rulesModel.delete(ruleThree);
  await deleteKinesisEventSourceMappings();
});

test.serial('Creating a kinesis rule where an event source mapping already exists, but is not enabled, succeeds', async (t) => {
  process.env.messageConsumer = randomString();

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'kinesis',
      value: randomString(),
    },
    state: 'ENABLED',
  });

  const lambdaStub = sinon.stub(awsServices, 'lambda')
    .returns({
      createEventSourceMapping: () => ({
        promise: () => Promise.resolve({ UUID: randomString() }),
      }),
      deleteEventSourceMapping: () => ({
        promise: () => Promise.resolve(),
      }),
      updateEventSourceMapping: () => ({
        promise: () => Promise.resolve({ UUID: randomString() }),
      }),
      listEventSourceMappings: () => ({
        promise: () => Promise.resolve({
          EventSourceMappings: [
            {
              UUID: randomString(),
              EventSourceArn: item.rule.value,
              FunctionArn: `arn:aws:lambda:us-west-2:000000000000:function:${process.env.messageConsumer}`,
              State: 'Disabled',
            },
          ],
        }),
      }),
    });

  try {
    await rulesModel.create(item);
    t.pass();
  } catch (error) {
    t.fail(error);
  } finally {
    lambdaStub.restore();
  }
});

test('creating an invalid kinesis type rule does not add event mappings', async (t) => {
  const { kinesisRule } = t.context;

  const newKinesisRule = cloneDeep(kinesisRule);
  delete newKinesisRule.name;

  // attempt to create rule
  await t.throwsAsync(rulesModel.create(newKinesisRule), { name: 'SchemaValidationError' });

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  console.log(JSON.stringify(kinesisEventMappings));

  t.is(consumerEventMappings.length, 0);
  t.is(logEventMappings.length, 0);
});

test('Creates a rule with a queueUrl parameter', async (t) => {
  const { onetimeRule } = t.context;

  const ruleItem = cloneDeep(onetimeRule);
  ruleItem.queueUrl = 'testQueue';

  const response = await rulesModel.create(ruleItem);

  const payload = await models.Rule.buildPayload(ruleItem);

  t.truthy(response.queueUrl);
  t.is(response.queueUrl, ruleItem.queueUrl);
  t.is(payload.queueUrl, ruleItem.queueUrl);
});

test('updates rule meta object', async (t) => {
  const { onetimeRule } = t.context;

  const triggerRule = randomId('triggerRule');
  const ruleItem = cloneDeep(onetimeRule);
  ruleItem.meta = {
    triggerRule,
  };

  const rule = await rulesModel.create(ruleItem);

  t.is(rule.meta.triggerRule, triggerRule);

  const newTriggerRule = randomId('triggerRule');
  const updates = { name: rule.name, meta: { triggerRule: newTriggerRule } };
  const updatedRule = await rulesModel.update(rule, updates);

  t.is(updatedRule.meta.triggerRule, newTriggerRule);
});

test('updates a deeply nested key', async (t) => {
  const { onetimeRule } = t.context;

  const testObject = {
    key: randomString(),
  };
  const ruleItem = cloneDeep(onetimeRule);
  ruleItem.meta = {
    testObject,
  };

  const rule = await rulesModel.create(ruleItem);

  t.deepEqual(rule.meta.testObject, testObject);

  const newTestObject = { ...testObject, key: randomString() };
  const updates = {
    name: rule.name,
    meta: {
      testObject: newTestObject,
    },
  };
  const updatedRule = await rulesModel.update(rule, updates);

  t.deepEqual(updatedRule.meta.testObject, newTestObject);
});

test('update preserves nested keys', async (t) => {
  const { onetimeRule } = t.context;

  const testObject = {
    key: randomString(),
  };
  const ruleItem = cloneDeep(onetimeRule);
  ruleItem.meta = {
    foo: 'bar',
    testObject,
  };

  const rule = await rulesModel.create(ruleItem);

  t.is(rule.meta.foo, 'bar');
  t.deepEqual(rule.meta.testObject, testObject);

  const newTestObject = { ...testObject, key: randomString() };
  const updates = {
    name: rule.name,
    meta: {
      testObject: newTestObject,
    },
  };
  const updatedRule = await rulesModel.update(rule, updates);

  t.is(updatedRule.meta.foo, 'bar');
  t.deepEqual(updatedRule.meta.testObject, newTestObject);
});

test('create, update and delete sqs type rule', async (t) => {
  const queueUrls = await createSqsQueues(randomString());
  const newQueueUrls = await createSqsQueues(randomString());

  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queueUrls.queueUrl,
    },
    state: 'ENABLED',
  });

  const createdRule = await rulesModel.create(rule);

  t.deepEqual(createdRule.rule, rule.rule);
  t.is(get(createdRule, 'meta.visibilityTimeout', 300), 300);
  t.is(get(createdRule, 'meta.retries', 3), 3);

  const testObject = {
    key: randomString(),
  };
  const updates = {
    name: rule.name,
    meta: {
      testObject: testObject,
      visibilityTimeout: 60,
      retries: 6,
    },
    rule: {
      value: newQueueUrls.queueUrl,
    },
  };

  const updatedRule = await rulesModel.update(createdRule, updates);

  t.deepEqual(updatedRule.meta.testObject, testObject);
  t.is(updatedRule.rule.value, newQueueUrls.queueUrl);
  t.is(get(updatedRule, 'meta.visibilityTimeout'), updates.meta.visibilityTimeout);
  t.is(get(updatedRule, 'meta.retries'), updates.meta.retries);

  await rulesModel.delete(updatedRule);

  const queues = Object.values(queueUrls).concat(Object.values(newQueueUrls));
  await Promise.all(
    queues.map((queueUrl) => awsServices.sqs().deleteQueue({ QueueUrl: queueUrl }).promise())
  );
});

test('creating SQS rule fails if queue does not exist', async (t) => {
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: 'non-existent-queue',
    },
    state: 'ENABLED',
  });
  await t.throwsAsync(
    rulesModel.create(rule),
    { message: /SQS queue non-existent-queue does not exist/ }
  );
});

test('creating SQS rule fails if there is no redrive policy on the queue', async (t) => {
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
    rulesModel.create(rule),
    { message: `SQS queue ${queueUrl} does not have a dead-letter queue configured` }
  );
});
