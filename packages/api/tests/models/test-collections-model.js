'use strict';

const test = require('ava');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  constructCollectionId
} = require('@cumulus/common/collection-config-store');
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
  await Promise.all([
    s3().putObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
      Body: JSON.stringify({})
    }).promise(),
    s3().putObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/workflow_template.json`,
      Body: JSON.stringify({})
    }).promise()
  ]);

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

async function testCollectionDelete(t, dataType) {
  const name = randomString();
  const version = randomString();
  const item = fakeCollectionFactory({ name, version, dataType });
  const { collectionConfigStore } = collectionsModel;
  const collectionId = constructCollectionId(dataType || name, version);

  await collectionsModel.create(item);
  t.true(await collectionsModel.exists(name, version));
  t.truthy(await collectionConfigStore.get(dataType || name, version));

  await collectionsModel.delete({ name, version, dataType });
  t.false(await collectionsModel.exists(name, version));
  // If the collection was successfully deleted from the config store, we
  // expect attempting to get it from the config store to throw an exception.
  await t.throwsAsync(
    async () => collectionConfigStore.get(dataType || name, version),
    { message: new RegExp(`${collectionId}`) }
  );
}

test(
  'Collection.delete() deletes a collection and removes its configuration store via name',
  async (t) => testCollectionDelete(t)
);

test(
  'Collection.delete() deletes a collection and removes its configuration store via dataType',
  async (t) => testCollectionDelete(t, randomString())
);

test('Collection.delete() does not throw exception when attempting to delete'
  + ' a collection that does not exist', async (t) => {
  const name = randomString();
  const version = randomString();

  t.false(await collectionsModel.exists(name, version));
  await collectionsModel.delete({ name, version });
  t.false(await collectionsModel.exists(name, version));
});
