'use strict';

const test = require('ava');
const pick = require('lodash/pick');
const sortBy = require('lodash/sortBy');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  constructCollectionId,
} = require('@cumulus/message/Collections');

const { AssociatedRulesError } = require('../../lib/errors');
const { Collection, Manager, Rule } = require('../../models');
const {
  fakeCollectionFactory,
  fakeRuleFactoryV2,
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

test.serial('Collection.exists() returns true when a record exists', async (t) => {
  const name = randomString();
  const version = randomString();
  const files = [
    {
      bucket: 'protectedbucket',
      regex: '^.*\\.hdf$',
      sampleFileName: 'samplefile.hdf',
      reportToEms: true,
    },
    {
      bucket: 'protectedbucket',
      regex: '^.*\\.cmr\\.xml$',
      sampleFileName: 'samplefile.cmr.xml',
    },
    {
      bucket: 'publicbucket',
      regex: '^.*\\.jpg$',
      sampleFileName: 'samplefile.jpg',
      reportToEms: true,
    },
  ];

  await collectionsModel.create(fakeCollectionFactory({ name, version, reportToEms: true, files }));

  t.true(await collectionsModel.exists(name, version));
});

test.serial('Collection.exists() returns false when a record does not exist', async (t) => {
  t.false(await collectionsModel.exists(randomString(), randomString()));
});

test.serial('Collection.delete() throws an exception if the collection has associated rules', async (t) => {
  const name = randomString();
  const version = randomString();

  await collectionsModel.create(fakeCollectionFactory({ name, version }));

  const rule = fakeRuleFactoryV2({
    collection: {
      name,
      version,
    },
    rule: {
      type: 'onetime',
    },
  });

  // The workflow message template must exist in S3 before the rule can be created
  await Promise.all([
    s3().putObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
      Body: JSON.stringify({}),
    }).promise(),
    s3().putObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/workflow_template.json`,
      Body: JSON.stringify({}),
    }).promise(),
  ]);

  const ruleWithTrigger = await ruleModel.createRuleTrigger(rule);
  await ruleModel.create(ruleWithTrigger);

  try {
    await collectionsModel.delete({ name, version });
    t.fail('Expected an exception to be thrown');
  } catch (error) {
    t.true(error instanceof AssociatedRulesError);
    t.is(error.message, 'Cannot delete a collection that has associated rules');
    t.deepEqual(error.rules, [rule.name]);
  }
});

test.serial(
  'Collection.delete() deletes a collection and removes its configuration store via name',
  async (t) => {
    const name = randomString();
    const version = randomString();
    const item = fakeCollectionFactory({ name, version });
    const { collectionConfigStore } = collectionsModel;
    const collectionId = constructCollectionId(name, version);

    await collectionsModel.create(item);
    t.true(await collectionsModel.exists(name, version));
    t.truthy(await collectionConfigStore.get(name, version));

    await collectionsModel.delete({ name, version });
    t.false(await collectionsModel.exists(name, version));
    // If the collection was successfully deleted from the config store, we
    // expect attempting to get it from the config store to throw an exception.
    await t.throwsAsync(
      () => collectionConfigStore.get(name, version),
      { message: new RegExp(`${collectionId}`) }
    );
  }
);

test.serial('Collection.delete() does not throw exception when attempting to delete'
  + ' a collection that does not exist', async (t) => {
  const name = randomString();
  const version = randomString();

  t.false(await collectionsModel.exists(name, version));
  await collectionsModel.delete({ name, version });
  t.false(await collectionsModel.exists(name, version));
});

test('Collection.get() does not return the deprecated `provider_path` field', async (t) => {
  const collection = fakeCollectionFactory({ provider_path: 'asdf' });

  const baseModel = new Manager({
    tableName: process.env.CollectionsTable,
    tableHash: { name: 'name', type: 'S' },
    tableRange: { name: 'version', type: 'S' },
    validate: false,
  });

  await baseModel.create(collection);

  const fetchedCollection = await collectionsModel.get({
    name: collection.name,
    version: collection.version,
  });

  t.is(fetchedCollection.provider_path, undefined);
});

test('Collection.getAllCollections() does not return the deprecated `provider_path` field', async (t) => {
  const collection = fakeCollectionFactory({ provider_path: 'asdf' });

  const baseModel = new Manager({
    tableName: process.env.CollectionsTable,
    tableHash: { name: 'name', type: 'S' },
    tableRange: { name: 'version', type: 'S' },
    validate: false,
  });

  await baseModel.create(collection);

  const fetchedCollections = await collectionsModel.getAllCollections();

  fetchedCollections.forEach((fetchedCollection) => {
    t.is(fetchedCollection.provider_path, undefined);
  });
});

test('Collection.search() returns the matching collections', async (t) => {
  const name = randomString();
  const collections = [
    fakeCollectionFactory({ name, version: randomString() }),
    fakeCollectionFactory({ name, version: randomString() }),
    fakeCollectionFactory()];
  await collectionsModel.create(collections);

  const searchParams = {
    name,
    updatedAt__from: Date.now() - 1000 * 30,
    updatedAt__to: Date.now(),
  };
  const fields = ['name', 'version', 'createdAt'];
  const collectionsQueue = collectionsModel.search(searchParams, fields);
  const fetchedCollections = await collectionsQueue.empty();
  t.is(fetchedCollections.length, 2);
  const expectedCollections = collections.slice(0, 2).map((collection) => pick(collection, fields));
  t.deepEqual(sortBy(fetchedCollections, fields), sortBy(expectedCollections, fields));
});
