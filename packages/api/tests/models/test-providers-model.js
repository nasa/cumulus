'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const schemas = require('../../models/schemas');
const {
  fakeProviderFactory,
  fakeRuleFactoryV2
} = require('../../lib/testUtils');
const { Manager, Provider, Rule } = require('../../models');
const { AssociatedRulesError } = require('../../lib/errors');

let manager;
let ruleModel;
test.before(async () => {
  process.env.ProvidersTable = randomString();

  manager = new Manager({
    tableName: process.env.ProvidersTable,
    tableHash: { name: 'id', type: 'S' },
    schema: schemas.provider
  });

  await manager.createTable();

  process.env.RulesTable = randomString();
  ruleModel = new Rule();
  await ruleModel.createTable();

  process.env.system_bucket = randomString();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  process.env.stackName = randomString();
});

test.after.always(async () => {
  await manager.deleteTable();
  await ruleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('Providers.exists() returns true when a record exists', async (t) => {
  const id = randomString();

  await manager.create(fakeProviderFactory({ id }));

  const providersModel = new Provider();

  t.true(await providersModel.exists(id));
});

test('Providers.exists() returns false when a record does not exist', async (t) => {
  const providersModel = new Provider();

  t.false(await providersModel.exists(randomString()));
});

test('Providers.delete() throws an exception if the provider has associated rules', async (t) => {
  const providersModel = new Provider();

  const providerId = randomString();
  await manager.create(fakeProviderFactory({ id: providerId }));

  const rule = fakeRuleFactoryV2({
    provider: providerId,
    rule: {
      type: 'onetime'
    }
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({})
  }).promise();

  await ruleModel.create(rule);

  try {
    await providersModel.delete({ id: providerId });
    t.fail('Expected an exception to be thrown');
  }
  catch (err) {
    t.true(err instanceof AssociatedRulesError);
    t.is(err.message, 'Cannot delete a provider that has associated rules');
    t.deepEqual(err.rules, [rule.name]);
  }
});

test('Providers.delete() deletes a provider', async (t) => {
  const providersModel = new Provider();

  const providerId = randomString();
  await manager.create(fakeProviderFactory({ id: providerId }));

  await providersModel.delete({ id: providerId });

  t.false(await manager.exists({ id: providerId }));
});

test('Providers.create() throws a ValidationError if an invalid host is used', async (t) => {
  const providersModel = new Provider();

  try {
    await providersModel.create(
      fakeProviderFactory({ host: 'http://www.example.com' })
    );

    t.fail('Expected an exception');
  }
  catch (err) {
    t.is(err.name, 'ValidationError');
  }
});

test('Providers.update() throws a ValidationError if an invalid host is used', async (t) => {
  const providersModel = new Provider();

  const provider = fakeProviderFactory();
  await providersModel.create(provider);

  try {
    await providersModel.update(
      { id: provider.id },
      { host: 'http://www.example.com' }
    );

    t.fail('Expected an exception');
  }
  catch (err) {
    t.is(err.name, 'ValidationError');
  }
});
