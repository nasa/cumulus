'use strict';

const fs = require('fs-extra');
const test = require('ava');
const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');

const awsServices = require('@cumulus/aws-client/services');
const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const SQS = require('@cumulus/aws-client/SQS');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const { ValidationError } = require('@cumulus/errors');

const {
  getSnsTriggerPermissionId,
} = require('../../../lib/snsRuleHelpers');
const models = require('../../../models');
const { createSqsQueues, fakeRuleFactoryV2 } = require('../../../lib/testUtils');

process.env.RulesTable = `RulesTable_${randomString()}`;
process.env.stackName = randomString();
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
  return await Promise.all(mappingPromises);
}

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

let rulesModel;

test.before(async () => {
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
  process.env.messageConsumerArn = lambda.FunctionArn;

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

test.beforeEach((t) => {
  t.context.onetimeRule = fakeRuleFactoryV2({
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
  });

  t.context.kinesisRule = fakeRuleFactoryV2({
    name: randomString(),
    workflow,
    provider: 'my-provider',
    collection: {
      name: 'my-collection-name',
      version: 'my-collection-version',
    },
    rule: {
      type: 'kinesis',
      value: `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`,
    },
    state: 'ENABLED',
  });
});

test.after.always(async () => {
  // cleanup table
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('createRuleTrigger() defaults rule state to ENABLED', async (t) => {
  const { onetimeRule } = t.context;

  // remove state from rule to be created
  delete onetimeRule.state;

  // create rule trigger
  const rule = await rulesModel.createRuleTrigger(onetimeRule);

  t.is(rule.state, 'ENABLED');

  // delete rule
  await rulesModel.delete(rule);
});

test('Creates and deletes a onetime rule', async (t) => {
  const { onetimeRule } = t.context;

  // create rule trigger and rule
  const ruleWithTrigger = await rulesModel.createRuleTrigger(onetimeRule);
  const rule = await rulesModel.create(ruleWithTrigger);

  t.is(rule.name, onetimeRule.name);

  // delete rule
  await rulesModel.delete(rule);
  t.false(await rulesModel.exists(rule.name));
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

  await t.throwsAsync(
    () => rulesModel.createRuleTrigger(ruleItem),
    { name: 'SchemaValidationError' }
  );
});

test('Enabling a disabled rule updates the state', async (t) => {
  const { onetimeRule } = t.context;

  const ruleItem = cloneDeep(onetimeRule);
  ruleItem.state = 'DISABLED';

  const ruleWithTrigger = await rulesModel.createRuleTrigger(ruleItem);
  const rule = await rulesModel.create(ruleWithTrigger);

  t.is(rule.state, 'DISABLED');

  const updates = { name: rule.name, state: 'ENABLED' };
  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

  t.is(updatedRule.name, rule.name);
  t.is(updatedRule.type, rule.type);
  t.is(updatedRule.state, 'ENABLED');

  await rulesModel.delete(rule);
});

test.serial('Updating a valid rule to have an invalid schema throws an error and does not update triggers', async (t) => {
  const { onetimeRule } = t.context;

  const ruleWithTrigger = await rulesModel.createRuleTrigger(onetimeRule);
  const rule = await rulesModel.create(ruleWithTrigger);

  const updates = { name: rule.name, rule: null };

  await t.throwsAsync(
    () => rulesModel.updateRuleTrigger(rule, updates),
    { name: 'SchemaValidationError' }
  );
});

test.serial('createRuleTrigger() for a kinesis type rule adds event mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create rule
  const ruleWithTrigger = await rulesModel.createRuleTrigger(kinesisRule);
  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 1);
  t.is(logEventMappings.length, 1);
  t.is(consumerEventMappings[0].UUID, ruleWithTrigger.rule.arn);
  t.is(logEventMappings[0].UUID, ruleWithTrigger.rule.logEventArn);

  t.is(ruleWithTrigger.name, kinesisRule.name);
  t.is(ruleWithTrigger.rule.value, kinesisRule.rule.value);
  t.false(ruleWithTrigger.rule.arn === undefined);
  t.false(ruleWithTrigger.rule.logEventArn === undefined);

  // clean up
  await deleteKinesisEventSourceMappings();
});

test.serial('Deleting a kinesis style rule removes event mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create and delete rule
  const ruleWithTrigger = await rulesModel.createRuleTrigger(kinesisRule);
  const createdRule = await rulesModel.create(ruleWithTrigger);
  t.true(await rulesModel.exists(createdRule.name));

  await rulesModel.delete(createdRule);

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 0);
  t.is(logEventMappings.length, 0);
});

test.serial('Updating a kinesis type rule state does not change event source mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create rule trigger and rule
  const ruleWithTrigger = await rulesModel.createRuleTrigger(kinesisRule);
  await rulesModel.create(ruleWithTrigger);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  // update rule state
  const updates = { name: rule.name, state: 'ENABLED' };
  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

  t.is(updatedRule.state, 'ENABLED');

  // Event source mapping references don't change
  t.is(updatedRule.rule.arn, rule.rule.arn);
  t.is(updatedRule.rule.logEventArn, rule.rule.logEventArn);

  // clean up
  await rulesModel.delete(rule);
  await deleteKinesisEventSourceMappings();
});

test.serial('Updating a kinesis type rule value results in new event source mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create rule trigger and rule
  const ruleWithTrigger = await rulesModel.createRuleTrigger(kinesisRule);
  await rulesModel.create(ruleWithTrigger);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  // update rule value
  const updates = {
    name: rule.name,
    rule: { type: rule.rule.type, value: `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}` },
  };

  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

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

test.serial('Calling updateRuleTrigger() with a kinesis type rule value does not delete existing source mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create rule trigger and rule
  const kinesisArn1 = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis1')}`;
  kinesisRule.rule.value = kinesisArn1;
  const ruleWithTrigger = await rulesModel.createRuleTrigger(kinesisRule);
  await rulesModel.create(ruleWithTrigger);

  const rule = await rulesModel.get({ name: kinesisRule.name });
  t.teardown(async () => {
    await rulesModel.delete(rule);
    await deleteKinesisEventSourceMappings();
  });

  // update rule value
  const updates = {
    name: rule.name,
    rule: { ...rule.rule, value: `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis2')}` },
  };

  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

  t.is(updatedRule.name, rule.name);
  t.not(updatedRule.rule.value, rule.rule.value);

  // Event source mappings exist and have been updated
  t.truthy(updatedRule.rule.arn);
  t.not(updatedRule.rule.arn, rule.rule.arn);
  t.truthy(updatedRule.rule.logEventArn);
  t.not(updatedRule.rule.logEventArn, rule.rule.logEventArn);

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 2);
  t.is(consumerEventMappings.filter((mapping) => mapping.EventSourceArn === kinesisArn1).length, 1);
  t.is(logEventMappings.length, 2);
  t.is(logEventMappings.filter((mapping) => mapping.EventSourceArn === kinesisArn1).length, 1);
});

test.serial('Calling updateRuleTrigger() with an SNS type rule value does not delete existing source mappings', async (t) => {
  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();
  const topic2 = await awsServices.sns().createTopic({ Name: randomId('topic2_') }).promise();

  // create rule trigger and rule
  const snsRule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: topic1.TopicArn,
    },
    state: 'ENABLED',
  });

  const snsRuleWithTrigger = await rulesModel.createRuleTrigger(snsRule);
  await rulesModel.create(snsRuleWithTrigger);

  const rule = await rulesModel.get({ name: snsRule.name });
  // do cleanup before `updateRuleTrigger` to avoid localstack bug.
  // see https://github.com/localstack/localstack/issues/5762.
  await rulesModel.deleteOldEventSourceMappings(rule);

  // update rule value
  const updates = {
    name: rule.name,
    rule: { ...rule.rule, value: topic2.TopicArn },
  };

  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

  t.teardown(async () => {
    await rulesModel.delete(updatedRule);
    await awsServices.sns().deleteTopic({ TopicArn: topic1.TopicArn }).promise();
    await awsServices.sns().deleteTopic({ TopicArn: topic2.TopicArn }).promise();
  });

  t.is(updatedRule.name, rule.name);
  t.not(updatedRule.rule.value, rule.rule.value);

  // Event source mappings exist and have been updated
  t.truthy(updatedRule.rule.arn);
  t.not(updatedRule.rule.arn, rule.rule.arn);
});

test.serial('deleteOldEventSourceMappings() removes kinesis source mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create rule trigger and rule
  kinesisRule.rule.value = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis1')}`;
  const ruleWithTrigger = await rulesModel.createRuleTrigger(kinesisRule);
  await rulesModel.create(ruleWithTrigger);

  const rule = await rulesModel.get({ name: kinesisRule.name });
  t.teardown(() => rulesModel.delete(rule));

  const [
    consumerEventMappingsBefore,
    logEventMappingsBefore,
  ] = await getKinesisEventMappings();
  t.is(consumerEventMappingsBefore.EventSourceMappings.length, 1);
  t.is(logEventMappingsBefore.EventSourceMappings.length, 1);

  await rulesModel.deleteOldEventSourceMappings(rule);

  const [
    consumerEventMappingsAfter,
    logEventMappingsAfter,
  ] = await getKinesisEventMappings();
  t.is(consumerEventMappingsAfter.EventSourceMappings.length, 0);
  t.is(logEventMappingsAfter.EventSourceMappings.length, 0);
});

test.serial('deleteOldEventSourceMappings() removes SNS source mappings and permissions', async (t) => {
  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();

  // create rule trigger and rule
  const snsRule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sns',
      value: topic1.TopicArn,
    },
    state: 'ENABLED',
  });

  const ruleWithTrigger = await rulesModel.createRuleTrigger(snsRule);
  await rulesModel.create(ruleWithTrigger);

  const rule = await rulesModel.get({ name: snsRule.name });

  const { subExists } = await rulesModel.checkForSnsSubscriptions(rule);
  t.true(subExists);

  const { Policy } = await awsServices.lambda().getPolicy({
    FunctionName: process.env.messageConsumer,
  }).promise();
  const { Statement } = JSON.parse(Policy);
  t.true(Statement.some((s) => s.Sid === getSnsTriggerPermissionId(rule)));

  await rulesModel.deleteOldEventSourceMappings(rule);

  const { subExists: subExists2 } = await rulesModel.checkForSnsSubscriptions(rule);
  t.false(subExists2);

  await t.throwsAsync(
    awsServices.lambda().getPolicy({
      FunctionName: process.env.messageConsumer,
    }).promise(),
    { code: 'ResourceNotFoundException' }
  );
});

test.serial('Updating a kinesis type rule workflow does not affect value or event source mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create rule trigger and rule
  const ruleWithTrigger = await rulesModel.createRuleTrigger(kinesisRule);
  await rulesModel.create(ruleWithTrigger);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  // update rule value
  const updates = {
    name: rule.name,
    workflow: 'new-workflow',
  };

  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

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

test.serial('Creating a kinesis type rule using existing event source mappings does not affect event source mappings', async (t) => {
  const { kinesisRule } = t.context;

  // create two rules with same value
  const newKinesisRule = cloneDeep(kinesisRule);
  newKinesisRule.name = `${kinesisRule.name}_new`;

  // create rule trigger and rule
  const ruleWithTrigger = await rulesModel.createRuleTrigger(kinesisRule);
  await rulesModel.create(ruleWithTrigger);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  const newRuleWithTrigger = await rulesModel.createRuleTrigger(newKinesisRule);
  await rulesModel.create(newRuleWithTrigger);
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

test.serial('It does not delete event source mappings if they exist for other rules', async (t) => {
  const { kinesisRule } = t.context;

  // we have three rules to create
  const kinesisRuleTwo = cloneDeep(kinesisRule);
  kinesisRuleTwo.name = `${kinesisRule.name}_two`;

  const kinesisRuleThree = cloneDeep(kinesisRule);
  kinesisRuleThree.name = `${kinesisRule.name}_three`;

  // create two rules with same value and one shared rule trigger
  const ruleWithTrigger = await rulesModel.createRuleTrigger(kinesisRule);
  await rulesModel.create(ruleWithTrigger);
  const rule = await rulesModel.get({ name: kinesisRule.name });
  const ruleWithTrigger2 = await rulesModel.createRuleTrigger(kinesisRuleTwo);
  await rulesModel.create(ruleWithTrigger2);
  const ruleTwo = await rulesModel.get({ name: kinesisRuleTwo.name });

  // same event source mapping
  t.is(ruleTwo.rule.arn, rule.rule.arn);
  t.is(ruleTwo.rule.logEventArn, rule.rule.logEventArn);

  // delete the second rule, it should not delete the event source mapping
  await rulesModel.delete(ruleTwo);

  // create third rule, it should use the existing event source mapping
  const ruleWithTrigger3 = await rulesModel.createRuleTrigger(kinesisRuleThree);
  await rulesModel.create(ruleWithTrigger3);
  const ruleThree = await rulesModel.get({ name: kinesisRuleThree.name });
  t.is(ruleThree.rule.arn, rule.rule.arn);
  t.is(ruleThree.rule.logEventArn, rule.rule.logEventArn);

  // Cleanup -- this is required for repeated local testing, else localstack retains rules
  await rulesModel.delete(rule);
  await rulesModel.delete(ruleThree);
  await deleteKinesisEventSourceMappings();
});

test.serial('Creating triggers for a kinesis rule where an event source mapping already exists, but is not enabled, succeeds', async (t) => {
  const kinesisArn = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`;
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'kinesis',
      value: kinesisArn,
    },
    state: 'ENABLED',
  });

  const params = {
    EventSourceArn: rule.rule.value,
    FunctionName: process.env.messageConsumer,
    StartingPosition: 'TRIM_HORIZON',
    Enabled: false,
  };
  await awsServices.lambda().createEventSourceMapping(params).promise();
  t.teardown(() => deleteKinesisEventSourceMappings());

  const mappings = await getKinesisEventMappings();
  const messageConsumerSource = mappings.find(
    (mapping) => mapping.EventSourceMappings.find(
      (eventSourceMapping) =>
        eventSourceMapping.FunctionArn === process.env.messageConsumerArn
        && eventSourceMapping.EventSourceArn === kinesisArn
    )
  );
  t.is(
    messageConsumerSource.EventSourceMappings.length,
    1
  );
  const [messageConsumerSourceMapping] = messageConsumerSource.EventSourceMappings;
  t.is(messageConsumerSourceMapping.State, 'Disabled');

  try {
    const ruleWithTrigger = await rulesModel.createRuleTrigger(rule);
    await rulesModel.create(ruleWithTrigger);
    t.pass();
  } catch (error) {
    t.fail(error);
  }
});

test('Creating an invalid kinesis type rule does not add event mappings', async (t) => {
  const { kinesisRule } = t.context;

  const newKinesisRule = cloneDeep(kinesisRule);
  delete newKinesisRule.name;

  // attempt to create rule
  await t.throwsAsync(rulesModel.createRuleTrigger(newKinesisRule), { name: 'SchemaValidationError' });

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  console.log(JSON.stringify(kinesisEventMappings));

  t.is(consumerEventMappings.length, 0);
  t.is(logEventMappings.length, 0);
});

test('Creating a rule with a queueUrl parameter succeeds', async (t) => {
  const { onetimeRule } = t.context;

  const ruleItem = cloneDeep(onetimeRule);
  ruleItem.queueUrl = 'testQueue';

  const ruleWithTrigger = await rulesModel.createRuleTrigger(ruleItem);
  const response = await rulesModel.create(ruleWithTrigger);

  const payload = await models.Rule.buildPayload(ruleItem);

  t.truthy(response.queueUrl);
  t.is(response.queueUrl, ruleItem.queueUrl);
  t.is(payload.queueUrl, ruleItem.queueUrl);
});

test('Updates rule meta object', async (t) => {
  const { onetimeRule } = t.context;

  const triggerRule = randomId('triggerRule');
  const ruleItem = cloneDeep(onetimeRule);
  ruleItem.meta = {
    triggerRule,
  };

  const ruleWithTrigger = await rulesModel.createRuleTrigger(ruleItem);
  const rule = await rulesModel.create(ruleWithTrigger);

  t.is(rule.meta.triggerRule, triggerRule);

  const newTriggerRule = randomId('triggerRule');
  const updates = { name: rule.name, meta: { triggerRule: newTriggerRule } };
  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

  t.is(updatedRule.meta.triggerRule, newTriggerRule);
});

test('Updates a deeply nested key', async (t) => {
  const { onetimeRule } = t.context;

  const testObject = {
    key: randomString(),
  };
  const ruleItem = cloneDeep(onetimeRule);
  ruleItem.meta = {
    testObject,
  };

  const ruleWithTrigger = await rulesModel.createRuleTrigger(ruleItem);
  const rule = await rulesModel.create(ruleWithTrigger);

  t.deepEqual(rule.meta.testObject, testObject);

  const newTestObject = { ...testObject, key: randomString() };
  const updates = {
    name: rule.name,
    meta: {
      testObject: newTestObject,
    },
  };
  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

  t.deepEqual(updatedRule.meta.testObject, newTestObject);
});

test('Update preserves nested keys', async (t) => {
  const { onetimeRule } = t.context;

  const testObject = {
    key: randomString(),
  };
  const ruleItem = cloneDeep(onetimeRule);
  ruleItem.meta = {
    foo: 'bar',
    testObject,
  };

  const ruleWithTrigger = await rulesModel.createRuleTrigger(ruleItem);
  const rule = await rulesModel.create(ruleWithTrigger);

  t.is(rule.meta.foo, 'bar');
  t.deepEqual(rule.meta.testObject, testObject);

  const newTestObject = { ...testObject, key: randomString() };
  const updates = {
    name: rule.name,
    meta: {
      testObject: newTestObject,
    },
  };
  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(rule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);
  t.is(updatedRule.meta.foo, 'bar');
  t.deepEqual(updatedRule.meta.testObject, newTestObject);
});

test('Creating, updating, and deleting SQS type rule succeeds', async (t) => {
  const queues = await createSqsQueues(randomString());
  const newQueues = await createSqsQueues(randomString());

  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: queues.queueUrl,
    },
    state: 'ENABLED',
  });

  const ruleWithTrigger = await rulesModel.createRuleTrigger(rule);
  const createdRule = await rulesModel.create(ruleWithTrigger);

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
      value: newQueues.queueUrl,
    },
  };

  const ruleWithUpdatedTrigger = await rulesModel.updateRuleTrigger(createdRule, updates);
  const updatedRule = await rulesModel.update(ruleWithUpdatedTrigger);

  t.deepEqual(updatedRule.meta.testObject, testObject);
  t.is(updatedRule.rule.value, newQueues.queueUrl);
  t.is(get(updatedRule, 'meta.visibilityTimeout'), updates.meta.visibilityTimeout);
  t.is(get(updatedRule, 'meta.retries'), updates.meta.retries);

  await rulesModel.delete(updatedRule);

  const queuesToDelete = [
    queues.queueUrl,
    queues.deadLetterQueueUrl,
    newQueues.queueUrl,
    newQueues.deadLetterQueueUrl,
  ];
  await Promise.all(
    queuesToDelete.map(
      (queueUrl) => awsServices.sqs().deleteQueue({ QueueUrl: queueUrl }).promise()
    )
  );
});

test('Creating a rule trigger SQS rule fails if queue does not exist', async (t) => {
  const rule = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: 'non-existent-queue',
    },
    state: 'ENABLED',
  });
  await t.throwsAsync(
    rulesModel.createRuleTrigger(rule),
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
    rulesModel.createRuleTrigger(rule),
    { message: `SQS queue ${queueUrl} does not have a dead-letter queue configured` }
  );
});

test.serial('Rule.exists() returns true when a record exists', async (t) => {
  const { onetimeRule } = t.context;

  const ruleWithTrigger = await rulesModel.createRuleTrigger(onetimeRule);
  await rulesModel.create(ruleWithTrigger);

  t.true(await rulesModel.exists(onetimeRule.name));
});

test.serial('Rule.exists() returns false when a record does not exist', async (t) => {
  t.false(await rulesModel.exists(randomString()));
});
