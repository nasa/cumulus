'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const { Manager, Provider, Rule } = require('../../models');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');
const MessageTemplateStore = require('../../lib/MessageTemplateStore');

let manager;
let messageTemplateStore;
let ruleModel;

test.before(async () => {
  process.env.bucket = randomString();
  process.env.stackName = randomString();
  process.env.ProvidersTable = randomString();
  process.env.RulesTable = randomString();

  manager = new Manager({
    tableName: process.env.ProvidersTable,
    tableHash: { name: 'id', type: 'S' }
  });

  ruleModel = new Rule();

  await Promise.all([
    s3().createBucket({ Bucket: process.env.bucket }).promise(),
    manager.createTable(),
    ruleModel.createTable()
  ]);

  messageTemplateStore = new MessageTemplateStore({
    bucket: process.env.bucket,
    s3: s3(),
    stackName: process.env.stackName
  });
});

test.beforeEach(async (t) => {
  t.context.providersModel = new Provider();
});

test.after.always(async () => {
  await Promise.all([
    recursivelyDeleteS3Bucket(process.env.bucket),
    manager.deleteTable(),
    ruleModel.deleteTable()
  ]);
});

test('Providers.exists() returns true when a record exists', async (t) => {
  const { providersModel } = t.context;

  const providerId = randomString();
  await manager.create({ id: providerId });

  t.true(await providersModel.exists(providerId));
});

test('Providers.exists() returns false when a record does not exist', async (t) => {
  const { providersModel } = t.context;

  t.false(await providersModel.exists(randomString()));
});

test('Providers.hasAssociatedRules() returns true when there is a rule associated with the provider', async (t) => {
  const { providersModel } = t.context;

  const providerId = randomString();
  await manager.create({ id: providerId });

  const rule = fakeRuleFactoryV2({
    provider: providerId,
    rule: {
      type: 'onetime'
    }
  });

  // The workflow message template must exist in S3 before the rule can be created
  await messageTemplateStore.put(rule.workflow, 'my-message-template');

  await ruleModel.create(rule);

  t.true(await providersModel.hasAssociatedRules(providerId));
});

test('Providers.hasAssociatedRules() returns false when there is not a rule associated with the provider', async (t) => {
  const { providersModel } = t.context;

  const providerId = randomString();
  await manager.create({ id: providerId });

  t.false(await providersModel.hasAssociatedRules(providerId));
});

test('Providers.delete() throws an exception if the provider does not exist', async (t) => {
  const { providersModel } = t.context;

  try {
    await providersModel.delete('does-not-exist');
    t.fail('Expected an exception to be thrown');
  }
  catch (err) {
    t.is(err.message, 'Provider does not exist');
  }
});

test('Providers.delete() throws an exception if the provider has associated rules', async (t) => {
  const { providersModel } = t.context;

  const providerId = randomString();
  await manager.create({ id: providerId });

  const rule = fakeRuleFactoryV2({
    provider: providerId,
    rule: {
      type: 'onetime'
    }
  });

  // The workflow message template must exist in S3 before the rule can be created
  await messageTemplateStore.put(rule.workflow, 'my-message-template');

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
  const { providersModel } = t.context;

  const providerId = randomString();
  await manager.create({ id: providerId });

  await providersModel.delete(providerId);

  t.false(await manager.exists({ id: providerId }));
});
