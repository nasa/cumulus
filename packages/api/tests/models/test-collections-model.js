'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');

const { AssociatedRulesError } = require('../../lib/errors');
const { Manager, Collection, Rule } = require('../../models');
const {
  fakeCollectionFactory,
  fakeRuleFactoryV2
} = require('../../lib/testUtils');
const schemas = require('../../models/schemas');

let manager;
let ruleModel;

test.before(async () => {
  process.env.CollectionsTable = randomString();

  manager = new Manager({
    tableName: process.env.CollectionsTable,
    tableHash: { name: 'name', type: 'S' },
    tableRange: { name: 'version', type: 'S' },
    schema: schemas.collection
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

test('Collection.exists() returns true when a record exists', async (t) => {
  const name = randomString();
  const version = randomString();

  await manager.create(fakeCollectionFactory({ name, version }));

  const collectionsModel = new Collection();

  t.true(await collectionsModel.exists(name, version));
});

test('Collection.exists() returns false when a record does not exist', async (t) => {
  const collectionsModel = new Collection();

  t.false(await collectionsModel.exists(randomString()));
});

test('Collection.delete() throws an exception if the collection has associated rules', async (t) => {
  const name = randomString();
  const version = randomString();

  await manager.create(fakeCollectionFactory({ name, version }));

  const rule = fakeRuleFactoryV2({
    collection: {
      name,
      version
    },
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

  const collectionsModel = new Collection();

  try {
    await collectionsModel.delete({ name, version });
    t.fail('Expected an exception to be thrown');
  }
  catch (err) {
    t.true(err instanceof AssociatedRulesError);
    t.is(err.message, 'Cannot delete a collection that has associated rules');
    t.deepEqual(err.rules, [rule.name]);
  }
});

test('Collection.delete() deletes a collection', async (t) => {
  const name = randomString();
  const version = randomString();

  await manager.create(fakeCollectionFactory({ name, version }));

  t.true(await manager.exists({ name, version }));

  const collectionsModel = new Collection();
  await collectionsModel.delete({ name, version });

  t.false(await manager.exists({ name, version }));
});
