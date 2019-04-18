'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');

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
