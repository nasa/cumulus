'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { AssociatedRulesError } = require('../../lib/errors');
const { Collection, Rule } = require('../../models');
const {
  fakeCollectionFactory,
  fakeRuleFactoryV2
} = require('../../lib/testUtils');

let collectionsModel;
let ruleModel;

test.before(async () => {
  process.env.CollectionsTable = randomString();
  process.env.RulesTable = randomString();
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();

  collectionsModel = new Collection();
  ruleModel = new Rule();

  await collectionsModel.createTable();
  await ruleModel.createTable();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();
});

test.after.always(async () => {
  await collectionsModel.deleteTable();
  await ruleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('Collection.exists() returns true when a record exists', async (t) => {
  const name = randomString();
  const version = randomString();

  await collectionsModel.create(fakeCollectionFactory({ name, version }));

  t.true(await collectionsModel.exists(name, version));
});

test('Collection.exists() returns false when a record does not exist', async (t) => {
  t.false(await collectionsModel.exists(randomString(), randomString()));
});

test('Collection.delete() throws an exception if the collection has associated rules', async (t) => {
  const name = randomString();
  const version = randomString();

  await collectionsModel.create(fakeCollectionFactory({ name, version }));

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

  try {
    await collectionsModel.delete({ name, version });
    t.fail('Expected an exception to be thrown');
  } catch (err) {
    t.true(err instanceof AssociatedRulesError);
    t.is(err.message, 'Cannot delete a collection that has associated rules');
    t.deepEqual(err.rules, [rule.name]);
  }
});

test('Collection.delete() deletes a collection', async (t) => {
  const name = randomString();
  const version = randomString();
  const cache = collectionsModel.collectionConfigStore.cache;
  const initialCacheSize = Object.keys(cache).length;

  await collectionsModel.create(fakeCollectionFactory({ name, version }));
  t.true(await collectionsModel.exists(name, version));
  t.is(Object.keys(cache).length, initialCacheSize + 1);

  await collectionsModel.delete({ name, version });
  t.false(await collectionsModel.exists(name, version));
  t.is(Object.keys(cache).length, initialCacheSize);
});
