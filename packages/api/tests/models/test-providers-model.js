'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');
const { Provider, Rule } = require('../../models');
const { AssociatedRulesError } = require('../../lib/errors');

const Registry = require('../../Registry');
const { providerModelCallback } = require('../../models/schemas');

let ruleModel;
let tableName;

test.before(async () => {
  process.env.ProvidersTable = randomString();
  tableName = process.env.ProvidersTable;
  await Registry.knex().schema.createTable(tableName, providerModelCallback);

  process.env.RulesTable = randomString();
  ruleModel = new Rule();
  await ruleModel.createTable();

  process.env.bucket = randomString();
  await s3().createBucket({ Bucket: process.env.bucket }).promise();
  process.env.stackName = randomString();
});

test.after.always(async () => {
  await Registry.knex().schema.dropTable(tableName);
  await ruleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.bucket);
});

test.serial('get() returns a translated row', async (t) => {
  const table = Registry.knex()(tableName);
  const id = randomString();
  await table.insert({
    id: id,
    global_connection_limit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  });

  const providersModel = new Provider();
  const actual = (await providersModel.get(id))[0];
  t.is(id, actual.id);
  t.is(10, actual.globalConnectionLimit);
});


test.serial('exists() returns true when a record exists', async (t) => {
  const table = Registry.knex()(tableName);
  const id = randomString();
  await table.insert({
    id: id,
    global_connection_limit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  });
  const providersModel = new Provider();
  t.true(await providersModel.exists(id));
});

test.serial('exists() returns false when a record does not exist', async (t) => {
  const providersModel = new Provider();
  t.false(await providersModel.exists(randomString()));
});

test.serial('delete() throws an exception if the provider has associated rules', async (t) => {
  const table = Registry.knex()(tableName);
  const providersModel = new Provider();
  const providerId = randomString();
  await table.insert({
    id: providerId,
    global_connection_limit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  });
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
    await providersModel.delete({ id: providerId });
    t.fail('Expected an exception to be thrown');
  }
  catch (err) {
    t.true(err instanceof AssociatedRulesError);
    t.is(err.message, 'Cannot delete a provider that has associated rules');
    t.deepEqual(err.rules, [rule.name]);
  }
});

test.serial('delete() deletes a provider', async (t) => {
  const table = Registry.knex()(tableName);
  const providersModel = new Provider();

  const providerId = randomString();
  await table.insert({
    id: providerId,
    global_connection_limit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  });

  await providersModel.delete({ id: providerId });

  t.false(await providersModel.exists({ id: providerId }));
});

test.serial('insert() inserts a translated provider', async (t) => {
  const table = Registry.knex()(tableName);
  const providersModel = new Provider();
  const providerId = randomString();
  const baseRecord = {
    id: providerId,
    globalConnectionLimit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  };
  await providersModel.insert(baseRecord);

  console.log(tableName);
  const actual = (await table.select().where({ id: providerId }))[0];
  const expected = {
    id: providerId,
    global_connection_limit: 10,
    protocol: 'http',
    host: '127.0.0.1',
    created_at: actual.created_at,
    updated_at: actual.updated_at,
    meta: null,
    password: null,
    port: null,
    username: null,
    encrypted: null
  };

  t.deepEqual(expected, actual);
});

test.serial('update() updates a record', async (t) => {
  const table = Registry.knex()(tableName);
  const providersModel = new Provider();
  const providerId = randomString();
  const updateRecord = { host: 'test_host' };
  const baseRecord = {
    id: providerId,
    global_connection_limit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  };
  await table.insert(baseRecord);
  await providersModel.update(providerId, updateRecord);
  const actual = (await providersModel.get(providerId))[0];
  t.is('test_host', actual.host);
});
