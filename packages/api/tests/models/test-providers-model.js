'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');
const { Provider, Rule } = require('../../models');
const { AssociatedRulesError } = require('../../lib/errors');
const Registry = require('../../lib/Registry');

let ruleModel;
let tableName;


test.beforeEach(async (t) => {
  t.context.table = Registry.knex()(tableName);
  t.context.id = randomString();
});

test.before(async () => {
  tableName = 'providers';

  process.env.RulesTable = randomString();
  ruleModel = new Rule();
  await ruleModel.createTable();

  process.env.bucket = randomString();
  await s3().createBucket({ Bucket: process.env.bucket }).promise();
  process.env.stackName = randomString();
});

test.after.always(async () => {
  await ruleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.bucket);
});

test.serial('get() returns a translated row', async (t) => {
  const id = t.context.id;
  await t.context.table.insert({
    id: id,
    global_connection_limit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  });

  const providersModel = new Provider();
  const actual = (await providersModel.get({ id }));
  t.is(id, actual.id);
  t.is(10, actual.globalConnectionLimit);
});


test.serial('exists() returns true when a record exists', async (t) => {
  const id = t.context.id;
  await t.context.table.insert({
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
  const id = t.context.id;
  const providersModel = new Provider();

  await t.context.table.insert({
    id: id,
    global_connection_limit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  });
  const rule = fakeRuleFactoryV2({
    provider: id,
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
    await providersModel.delete({ id: id });
    t.fail('Expected an exception to be thrown');
  }
  catch (err) {
    t.true(err instanceof AssociatedRulesError);
    t.is(err.message, 'Cannot delete a provider that has associated rules');
    t.deepEqual(err.rules, [rule.name]);
  }
});

test.serial('delete() deletes a provider', async (t) => {
  const id = t.context.id;
  const providersModel = new Provider();

  await t.context.table.insert({
    id: id,
    global_connection_limit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  });

  await providersModel.delete({ id: id });

  t.false(await providersModel.exists({ id: id }));
});

test.serial('insert() inserts a translated provider', async (t) => {
  const id = t.context.id;
  const providersModel = new Provider();
  const baseRecord = {
    id,
    globalConnectionLimit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  };
  await providersModel.insert(baseRecord);

  const actual = { ...(await t.context.table.select().where({ id: id }))[0] };
  const expected = {
    id,
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

  t.deepEqual(actual, expected);
});

test.serial('update() updates a record', async (t) => {
  const id = t.context.id;
  const providersModel = new Provider();
  const updateRecord = { host: 'test_host' };
  const baseRecord = {
    id: id,
    global_connection_limit: 10,
    protocol: 'http',
    host: '127.0.0.1'
  };
  await t.context.table.insert(baseRecord);
  await providersModel.update({ id }, updateRecord);
  const actual = (await providersModel.get({ id }));
  t.is('test_host', actual.host);
});
