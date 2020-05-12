'use strict';

const test = require('ava');

const awsServices = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');

const models = require('../../../models');
const { createSqsQueues, fakeRuleFactoryV2 } = require('../../../lib/testUtils');

process.env.RulesTable = randomId('rules');
process.env.stackName = randomId('stack');
process.env.messageConsumer = randomId('message');
process.env.KinesisInboundEventLogger = randomId('kinesis');
process.env.system_bucket = randomId('bucket');

const workflow = randomId('workflow');
const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
const templateFile = `${process.env.stackName}/workflow_template.json`;

let rulesModel;

// Kinesis rules
const testCollectionName = randomId('collection');
const collection = {
  name: testCollectionName,
  version: '0.0.0'
};
const provider = { id: 'PROV1' };

const commonRuleParams = {
  collection,
  provider: provider.id
};

const kinesisRuleParams = {
  rule: {
    type: 'kinesis',
    value: 'test-kinesisarn'
  }
};

const kinesisRule1 = {
  ...commonRuleParams,
  ...kinesisRuleParams,
  name: 'testRule1',
  workflow,
  state: 'ENABLED'
};

// if the state is not provided, it will be set to default value 'ENABLED'
const kinesisRule2 = {
  ...commonRuleParams,
  ...kinesisRuleParams,
  name: 'testRule2',
  workflow
};

const kinesisRule3 = {
  ...commonRuleParams,
  ...kinesisRuleParams,
  collection: {
    name: testCollectionName,
    version: '1.0.0'
  },
  name: 'testRule3',
  workflow,
  state: 'ENABLED'
};

const kinesisRule4 = {
  ...commonRuleParams,
  name: 'testRule4',
  workflow,
  state: 'ENABLED',
  rule: {
    type: 'kinesis',
    value: 'kinesisarn-4'
  }
};

const kinesisRule5 = {
  ...commonRuleParams,
  collection: {
    name: testCollectionName,
    version: '2.0.0'
  },
  name: 'testRule5',
  workflow,
  state: 'ENABLED',
  rule: {
    type: 'kinesis',
    value: 'kinesisarn-5'
  }
};

const disabledKinesisRule = {
  ...commonRuleParams,
  ...kinesisRuleParams,
  name: 'disabledRule',
  workflow,
  state: 'DISABLED'
};

test.before(async () => {
  // create Rules table
  rulesModel = new models.Rule();
  await rulesModel.createTable();

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  await Promise.all([
    awsServices.s3().putObject({
      Bucket: process.env.system_bucket,
      Key: workflowfile,
      Body: '{}'
    }).promise(),
    awsServices.s3().putObject({
      Bucket: process.env.system_bucket,
      Key: templateFile,
      Body: '{}'
    }).promise()
  ]);

  const rulesToCreate = [
    kinesisRule1,
    kinesisRule2,
    kinesisRule3,
    kinesisRule4,
    kinesisRule5,
    disabledKinesisRule
  ];
  await Promise.all(rulesToCreate.map((rule) => rulesModel.create(rule)));
});

test.after.always(async () => {
  await rulesModel.deleteTable();
});

test('queryRules returns correct list of rules', async (t) => {
  const queueUrls = await createSqsQueues(randomId('queue'));
  const rules = [
    fakeRuleFactoryV2({
      workflow,
      rule: {
        type: 'onetime'
      },
      state: 'ENABLED'
    }),
    fakeRuleFactoryV2({
      workflow,
      rule: {
        type: 'sqs',
        value: queueUrls.queueUrl
      },
      state: 'ENABLED'
    }),
    fakeRuleFactoryV2({
      workflow,
      rule: {
        type: 'onetime'
      },
      state: 'DISABLED'
    })
  ];
  const createdRules = await Promise.all(
    rules.map((rule) => rulesModel.create(rule))
  );

  await Promise.all(
    Object.values(queueUrls)
      .map((queueUrl) => awsServices.sqs().deleteQueue({ QueueUrl: queueUrl }).promise())
  );

  const result = await rulesModel.queryRules({
    status: 'ENABLED',
    type: 'onetime'
  });
  t.truthy(result.find((rule) => rule.name === createdRules[0].name));
  t.falsy(result.find((rule) => rule.name === createdRules[1].name));
  t.falsy(result.find((rule) => rule.name === createdRules[2].name));
});

test.todo('queryRules defaults to returning only ENABLED rules');

test('queryRules should look up kinesis-type rules which are associated with the collection, but not those that are disabled', async (t) => {
  const result = await rulesModel.queryRules({
    name: testCollectionName,
    type: 'kinesis'
  });
  t.is(result.length, 5);
});

test('it should look up kinesis-type rules which are associated with the collection name and version', async (t) => {
  const result = await rulesModel.queryRules({
    name: testCollectionName,
    version: '1.0.0',
    type: 'kinesis'
  });
  t.is(result.length, 1);
});

test('it should look up kinesis-type rules which are associated with the source ARN', async (t) => {
  const result = await rulesModel.queryRules({
    sourceArn: 'kinesisarn-4',
    type: 'kinesis'
  });
  t.is(result.length, 1);
});

test('it should look up kinesis-type rules which are associated with the collection name/version and source ARN', async (t) => {
  const result = await rulesModel.queryRules({
    name: testCollectionName,
    version: '2.0.0',
    sourceArn: 'kinesisarn-5',
    type: 'kinesis'
  });
  t.is(result.length, 1);
});
