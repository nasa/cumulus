'use strict';

const test = require('ava');
const sinon = require('sinon');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');

process.env.RulesTable = `RulesTable_${randomString()}`;
process.env.stackName = randomString();
process.env.messageConsumer = randomString();
process.env.KinesisInboundEventLogger = randomString();
process.env.system_bucket = randomString();

const workflow = randomString();
const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;

const kinesisRule = {
  name: randomString(),
  workflow,
  provider: 'my-provider',
  collection: {
    name: 'my-collection-name',
    version: 'my-collection-version'
  },
  rule: {
    type: 'kinesis',
    value: 'my-kinesis-arn'
  },
  state: 'DISABLED'
};

const onetimeRule = {
  name: 'my_one_time_rule',
  workflow,
  provider: 'my-provider',
  collection: {
    name: 'my-collection-name',
    version: 'my-collection-version'
  },
  rule: {
    type: 'onetime'
  },
  state: 'ENABLED'
};

async function getKinesisEventMappings() {
  const eventLambdas = [process.env.messageConsumer, process.env.KinesisInboundEventLogger];

  const mappingPromises = eventLambdas.map((lambda) => {
    const mappingParms = { FunctionName: lambda };
    return aws.lambda().listEventSourceMappings(mappingParms).promise();
  });
  return Promise.all(mappingPromises);
}


let ruleModel;
test.before(async () => {
  // create Rules table
  ruleModel = new models.Rule();
  await ruleModel.createTable();
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  await aws.s3().putObject({
    Bucket: process.env.system_bucket,
    Key: workflowfile,
    Body: 'test data'
  }).promise();
});

test.after.always(async () => {
  // cleanup table
  await ruleModel.deleteTable();
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('create and delete a onetime rule', async (t) => {
  // create rule
  const rules = new models.Rule();
  return rules.create(onetimeRule)
    .then(async (rule) => {
      t.is(rule.name, onetimeRule.name);
      // delete rule
      await rules.delete(rule);
    });
});

test.serial('create a kinesis type rule adds event mappings, creates rule', async (t) => {
  // create rule
  const rules = new models.Rule();
  const createdRule = await rules.create(kinesisRule);

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
  await rules.delete(createdRule);
});

test.serial('deleting a kinesis style rule removes event mappings', async (t) => {
  // create and delete rule
  const rules = new models.Rule();
  const createdRule = await rules.create(kinesisRule);
  await rules.delete(createdRule);

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 0);
  t.is(logEventMappings.length, 0);
});

test.serial('update a kinesis type rule state, arn does not change', async (t) => {
  // create rule
  const rules = new models.Rule();
  await rules.create(kinesisRule);
  const rule = await rules.get({ name: kinesisRule.name });
  // update rule state
  const updated = { name: rule.name, state: 'ENABLED' };
  // deep copy rule
  const newRule = Object.assign({}, rule);
  newRule.rule = Object.assign({}, rule.rule);
  await rules.update(newRule, updated);
  t.true(newRule.state === 'ENABLED');
  //arn doesn't change
  t.is(newRule.rule.arn, rule.rule.arn);
  t.is(newRule.rule.logEventArn, rule.rule.logEventArn);

  // clean up
  await rules.delete(rule);
});

test.serial('update a kinesis type rule value, resulting in new arn', async (t) => {
  // create rule
  const rules = new models.Rule();
  await rules.create(kinesisRule);
  const rule = await rules.get({ name: kinesisRule.name });

  // update rule value
  const updated = {
    name: rule.name,
    rule: { type: rule.rule.type, value: 'my-new-kinesis-arn' }
  };
  // deep copy rule
  const newRule = Object.assign({}, rule);
  newRule.rule = Object.assign({}, rule.rule);
  await rules.update(newRule, updated);

  t.is(newRule.name, rule.name);
  t.not(newRule.rule.vale, rule.rule.value);
  t.not(newRule.rule.arn, rule.rule.arn);
  t.not(newRule.rule.logEventArn, rule.rule.logEventArn);

  await rules.delete(rule);
  await rules.delete(newRule);
});

test.serial('create a kinesis type rule, using the existing event source mappings', async (t) => {
  // create two rules with same value
  const rules = new models.Rule();
  const newKinesisRule = Object.assign({}, kinesisRule);
  newKinesisRule.rule = Object.assign({}, kinesisRule.rule);
  newKinesisRule.name = `${kinesisRule.name}_new`;

  await rules.create(kinesisRule);
  const rule = await rules.get({ name: kinesisRule.name });

  await rules.create(newKinesisRule);
  const newRule = await rules.get({ name: newKinesisRule.name });

  t.not(newRule.name, rule.name);
  t.is(newRule.rule.value, rule.rule.value);
  t.false(newRule.rule.arn === undefined);
  t.false(newRule.rule.logEventArn === undefined);
  // same event source mapping
  t.is(newRule.rule.arn, rule.rule.arn);
  t.is(newRule.rule.logEventArn, rule.rule.logEventArn);

  await rules.delete(rule);
  await rules.delete(newRule);
});

test.serial('it does not delete event source mappings if they exist for other rules', async (t) => {
  // we have three rules to create
  const kinesisRuleTwo = Object.assign({}, kinesisRule);
  kinesisRuleTwo.rule = Object.assign({}, kinesisRule.rule);
  kinesisRuleTwo.name = `${kinesisRule.name}_two`;
  const kinesisRuleThree = Object.assign({}, kinesisRule);
  kinesisRuleThree.rule = Object.assign({}, kinesisRule.rule);
  kinesisRuleThree.name = `${kinesisRule.name}_three`;

  const rules = new models.Rule();
  // create two rules with same value
  await rules.create(kinesisRule);
  const rule = await rules.get({ name: kinesisRule.name });
  await rules.create(kinesisRuleTwo);
  const ruleTwo = await rules.get({ name: kinesisRuleTwo.name });

  // same event source mapping
  t.is(ruleTwo.rule.arn, rule.rule.arn);
  t.is(ruleTwo.rule.logEventArn, rule.rule.logEventArn);

  // delete the second rule, it should not delete the event source mapping
  await rules.delete(ruleTwo);

  // create third rule, it should use the existing event source mapping
  await rules.create(kinesisRuleThree);
  const ruleThree = await rules.get({ name: kinesisRuleThree.name });
  t.is(ruleThree.rule.arn, rule.rule.arn);
  t.is(ruleThree.rule.logEventArn, rule.rule.logEventArn);

  // Cleanup -- this is required for repeated local testing, else localstack retains rules
  await rules.delete(rule);
  await rules.delete(ruleThree);
});

test.serial('Creating a kinesis rule where an event source mapping already exists, but is not enabled, succeeds', async (t) => {
  process.env.messageConsumer = randomString();

  const item = fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'kinesis',
      value: randomString()
    },
    state: 'ENABLED'
  });

  const lambdaStub = sinon.stub(aws, 'lambda')
    .returns({
      createEventSourceMapping: () => ({
        promise: () => Promise.resolve({ UUID: randomString() })
      }),
      updateEventSourceMapping: () => ({
        promise: () => Promise.resolve()
      }),
      deleteEventSourceMapping: () => ({
        promise: () => Promise.resolve()
      }),
      listEventSourceMappings: () => ({
        promise: () => Promise.resolve({
          EventSourceMappings: [
            {
              UUID: randomString(),
              EventSourceArn: item.rule.value,
              FunctionArn: `arn:aws:lambda:us-west-2:000000000000:function:${process.env.messageConsumer}`,
              State: 'Disabled'
            }
          ]
        })
      })
    });

  try {
    await (new models.Rule()).create(item);
    t.pass();
  } catch (err) {
    t.fail(err);
  } finally {
    lambdaStub.reset();
  }
});
