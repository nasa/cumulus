'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');
const { Manager, Provider, Rule } = require('../../models');

let manager;
let ruleModel;
test.before(async () => {
  process.env.ProvidersTable = randomString();

  manager = new Manager({
    tableName: process.env.ProvidersTable,
    tableHash: { name: 'id', type: 'S' }
  });

  await manager.createTable();

  process.env.RulesTable = randomString();
  ruleModel = new Rule();
  await ruleModel.createTable();

  process.env.bucket = randomString();
  await s3().createBucket({ Bucket: process.env.bucket }).promise();

  process.env.stackName = randomString();
});

test.after.always(async () => {
  await manager.deleteTable();
  await ruleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.bucket);
});

test('Providers.exists() returns true when a record exists', async (t) => {
  const id = randomString();

  await manager.create({ id });

  const providersModel = new Provider();

  t.true(await providersModel.exists(id));
});

test('Providers.exists() returns false when a record does not exist', async (t) => {
  const providersModel = new Provider();

  t.false(await providersModel.exists(randomString()));
});

test('Providers.hasAssociatedRules() returns true when there is a rule associated with the provider', async (t) => {
  const providersModel = new Provider();

  const providerId = randomString();
  await manager.create({ id: providerId });

  const rule = fakeRuleFactoryV2({
    provider: providerId,
    rule: {
      type: 'onetime'
    }
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({})
  }).promise();

  await ruleModel.create(rule);

  t.true(await providersModel.hasAssociatedRules(providerId));
});

test('Providers.hasAssociatedRules() returns false when there is not a rule associated with the provider', async (t) => {
  const providersModel = new Provider();

  const providerId = randomString();
  await manager.create({ id: providerId });

  t.false(await providersModel.hasAssociatedRules(providerId));
});

test('Providers.delete() throws an exception if the provider does not exist', async (t) => {
  const providersModel = new Provider();

  try {
    await providersModel.delete('does-not-exist');
    t.fail('Expected an exception to be thrown');
  }
  catch (err) {
    t.is(err.message, 'Provider does not exist');
  }
});

test('Providers.delete() throws an exception if the provider has associated rules', async (t) => {
  const providersModel = new Provider();

  const providerId = randomString();
  await manager.create({ id: providerId });

  const rule = fakeRuleFactoryV2({
    provider: providerId,
    rule: {
      type: 'onetime'
    }
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({})
  }).promise();

  await ruleModel.create(rule);

  try {
    await providersModel.delete(providerId);
    t.fail('Expected an exception to be thrown');
  }
  catch (err) {
    t.is(err.message, 'Cannot delete a provider that has associated rules');
  }
});

test('Providers.delete() deletes a provider', async (t) => {
  const providersModel = new Provider();

  const providerId = randomString();
  await manager.create({ id: providerId });

  await providersModel.delete(providerId);

  t.false(await manager.exists({ id: providerId }));
});
