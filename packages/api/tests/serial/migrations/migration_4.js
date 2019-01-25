'use strict';

const aws = require('@cumulus/common/aws');
const test = require('ava');
const {
  aws: { dynamodb, lambda, s3 },
  testUtils: { randomString }
} = require('@cumulus/common');
const { run } = require('../../../migrations/migration_4');
const models = require('../../../models');

process.env.RulesTable = `RulesTable_${randomString()}`;
process.env.stackName = 'my-stackName';
process.env.messageConsumer = 'my-messageConsumer';
process.env.KinesisInboundEventLogger = 'my-ruleInput';
process.env.system_bucket = randomString();

const workflow = 'my-workflow';
const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;

const kinesisRule = {
  name: 'my_kinesis_rule',
  workflow: 'my-workflow',
  provider: 'my-provider',
  collection: {
    name: 'my-collection-name',
    version: 'my-collection-version'
  },
  rule: {
    type: 'kinesis',
    value: 'test-kinesisarn'
  },
  state: 'DISABLED'
};

let ruleModel;


async function getKinesisEventMappings() {
  const eventLambdas = [process.env.messageConsumer, process.env.KinesisInboundEventLogger];
  const mappingPromises = eventLambdas.map((eventLambda) => {
    const mappingParms = { FunctionName: eventLambda };
    return aws.lambda().listEventSourceMappings(mappingParms).promise();
  });
  return Promise.all(mappingPromises);
}

test.before(async () => {
  // create Rules table
  ruleModel = new models.Rule();
  await ruleModel.createTable();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: workflowfile,
    Body: 'test data'
  }).promise();

  const eventMappingObjects = await getKinesisEventMappings();
  const sourceMappingLists = eventMappingObjects.map((mapObject) => mapObject.EventSourceMappings);

  const eventSourceMapping = [].concat(...sourceMappingLists);
  const eventMappingPromises = eventSourceMapping.map((mapping) => {
    const params = { UUID: mapping.UUID };
    return lambda().deleteEventSourceMapping(params).promise();
  });
  await Promise.all(eventMappingPromises);
});


test.after.always(async () => {
  // cleanup table
  await ruleModel.deleteTable();
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
  const rule = new models.Rule();
  rule.delete(kinesisRule);
});

test.serial('migration_4 adds a logEvent mapping when missing', async (t) => {
  // create rule
  const rule = new models.Rule();
  await rule.create(kinesisRule);
  const createdRule = await rule.get({ name: kinesisRule.name });

  // Remove mapping from function, remove value from DB entry.
  lambda().deleteEventSourceMapping({ UUID: createdRule.rule.logEventArn }).promise();
  await dynamodb().updateItem({
    TableName: process.env.RulesTable,
    Key: { name: { S: kinesisRule.name } },
    UpdateExpression: 'REMOVE #R.logEventArn',
    ExpressionAttributeNames: { '#R': 'rule' }
  }).promise();
  const ruleItem = await dynamodb().getItem({
    TableName: process.env.RulesTable,
    Key: { name: { S: kinesisRule.name } }
  }).promise();
  await run({ bucket: process.env.system_bucket, stackName: process.env.stackName });
  const updateRuleItem = await dynamodb().getItem({
    TableName: process.env.RulesTable,
    Key: { name: { S: kinesisRule.name } }
  }).promise();

  const mappingParms = { FunctionName: process.env.KinesisInboundEventLogger };
  const mappingsResponse = await lambda().listEventSourceMappings(mappingParms).promise();
  const eventSourceMappings = mappingsResponse.EventSourceMappings;

  t.is(eventSourceMappings.length, 1);
  t.is(eventSourceMappings[0].UUID, updateRuleItem.Item.rule.M.logEventArn.S);
  t.is(updateRuleItem.Item.rule.M.arn.S, ruleItem.Item.rule.M.arn.S);
  t.is(updateRuleItem.Item.rule.M.type.S, ruleItem.Item.rule.M.type.S);
  t.is(updateRuleItem.Item.rule.M.value.S, ruleItem.Item.rule.M.value.S);
  await rule.delete(kinesisRule);
});

test.serial('migration_4 ignores logEvent mapping when not missing', async (t) => {
  // create rule
  const rule = new models.Rule();
  await rule.create(kinesisRule);
  const ruleItem = await dynamodb().getItem({
    TableName: process.env.RulesTable,
    Key: { name: { S: kinesisRule.name } }
  }).promise();
  await run({ bucket: process.env.system_bucket, stackName: process.env.stackName });
  const updateRuleItem = await dynamodb().getItem({
    TableName: process.env.RulesTable,
    Key: { name: { S: kinesisRule.name } }
  }).promise();

  const mappingParms = { FunctionName: process.env.KinesisInboundEventLogger };
  const mappingsResponse = await lambda().listEventSourceMappings(mappingParms).promise();
  const eventSourceMappings = mappingsResponse.EventSourceMappings;

  t.is(eventSourceMappings.length, 1);
  t.is(eventSourceMappings[0].UUID, updateRuleItem.Item.rule.M.logEventArn.S);
  t.is(updateRuleItem.Item.rule.M.arn.S, ruleItem.Item.rule.M.arn.S);
  t.is(updateRuleItem.Item.rule.M.type.S, ruleItem.Item.rule.M.type.S);
  t.is(updateRuleItem.Item.rule.M.value.S, ruleItem.Item.rule.M.value.S);
  t.is(updateRuleItem.Item.rule.M.logEventArn.S, ruleItem.Item.rule.M.logEventArn.S);

  await rule.delete(kinesisRule);
});
