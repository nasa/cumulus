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
  state: 'ENABLED'
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

let rulesModel;

test.before(async () => {
  // create Rules table
  rulesModel = new models.Rule();
  await rulesModel.createTable();
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  await aws.s3().putObject({
    Bucket: process.env.system_bucket,
    Key: workflowfile,
    Body: 'test data'
  }).promise();
});

test.after.always(async () => {
  // cleanup table
  await rulesModel.deleteTable();
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('create and delete a onetime rule', async (t) => {
  // create rule
  return rulesModel.create(onetimeRule)
    .then(async (rule) => {
      t.is(rule.name, onetimeRule.name);
      // delete rule
      await rulesModel.delete(rule);
    });
});

test.serial('create a kinesis type rule adds event mappings, creates rule', async (t) => {
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
});

test.serial('deleting a kinesis style rule removes event mappings', async (t) => {
  // create and delete rule
  const createdRule = await rulesModel.create(kinesisRule);
  await rulesModel.delete(createdRule);

  const kinesisEventMappings = await getKinesisEventMappings();
  const consumerEventMappings = kinesisEventMappings[0].EventSourceMappings;
  const logEventMappings = kinesisEventMappings[1].EventSourceMappings;

  t.is(consumerEventMappings.length, 0);
  t.is(logEventMappings.length, 0);
});

test.serial('update a kinesis type rule state, event source mappings do not change', async (t) => {
  // create rule
  await rulesModel.create(kinesisRule);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  // update rule state
  const updates = { name: rule.name, state: 'ENABLED' };

  // deep copy rule
  const updatedRule = await rulesModel.update(rule, updates);
  t.true(updatedRule.state === 'ENABLED');

  // Event source mapping references don't change
  t.is(updatedRule.rule.arn, rule.rule.arn);
  t.is(updatedRule.rule.logEventArn, rule.rule.logEventArn);

  // clean up
  await rulesModel.delete(rule);
});

test.serial('update a kinesis type rule value, resulting in new event source mappings', async (t) => {
  // create rule
  await rulesModel.create(kinesisRule);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  // update rule value
  const updates = {
    name: rule.name,
    rule: { type: rule.rule.type, value: 'my-new-kinesis-arn' }
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
});

test.serial('update a kinesis type rule workflow does not affect value or event source mappings', async (t) => {
  // create rule
  await rulesModel.create(kinesisRule);
  const rule = await rulesModel.get({ name: kinesisRule.name });

  // update rule value
  const updates = {
    name: rule.name,
    workflow: 'new-workflow'
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
});

test.serial('create a kinesis type rule, using existing event source mappings', async (t) => {
  // create two rules with same value
  const newKinesisRule = {
    ...kinesisRule,
    name: `${kinesisRule.name}_new`,
    rule: {
      ...kinesisRule.rule
    }
  };

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
});

test.serial('it does not delete event source mappings if they exist for other rules', async (t) => {
  // we have three rules to create
  const kinesisRuleTwo = {
    ...kinesisRule,
    name: `${kinesisRule.name}_two`,
    rule: {
      ...kinesisRule.rule
    }
  };

  const kinesisRuleThree = {
    ...kinesisRule,
    name: `${kinesisRule.name}_three`,
    rule: {
      ...kinesisRule.rule
    }
  };

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
      deleteEventSourceMapping: () => ({
        promise: () => Promise.resolve()
      }),
      updateEventSourceMapping: () => ({
        promise: () => Promise.resolve({ UUID: randomString() })
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
    await rulesModel.create(item);
    t.pass();
  } catch (err) {
    t.fail(err);
  } finally {
    lambdaStub.reset();
  }
});

test.serial('Creating a rule with a queueName parameter', async (t) => {
  const ruleItem = {
    ...onetimeRule,
    queueName: 'testQueue'
  };

  const response = await rulesModel.create(ruleItem);

  const payload = await models.Rule.buildPayload(ruleItem);

  t.is(response.queueName, ruleItem.queueName);
  t.is(payload.queueName, ruleItem.queueName);
});
