'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { knex } = require('@cumulus/db');
const S3 = require('@cumulus/aws-client/S3');
const Collection = require('../../../models/collections');
const RulesModel = require('../../../models/rules');
const { put } = require('../../../endpoints/collections');
const { fakeCollectionFactory } = require('../../../lib/testUtils');
const bootstrap = require('../../../lambdas/bootstrap');
const { buildFakeExpressResponse } = require('../utils');

test.before(async (t) => {
  process.env.system_bucket = randomString();

  process.env.CollectionsTable = randomString();
  t.context.collectionsModel = new Collection();

  process.env.RulesTable = randomString();
  const rulesModel = new RulesModel();

  process.env.ES_INDEX = randomString();

  await Promise.all([
    S3.createBucket(process.env.system_bucket),
    t.context.collectionsModel.createTable(),
    rulesModel.createTable(),
    bootstrap.bootstrapElasticSearch(
      'fakehost',
      randomString(),
      process.env.ES_INDEX
    ),
  ]);

  t.context.dbClient = knex.createLocalStackClient();

  t.context.nullLogger = { error: () => undefined };
});

test.beforeEach(async (t) => {
  t.context.collection = fakeCollectionFactory({
    duplicateHandling: 'replace',
  });

  const dynamoRecord = await t.context.collectionsModel.create(
    t.context.collection
  );

  const dbRecord = {
    ...t.context.collection,
    granuleIdValidationRegex: t.context.collection.granuleId,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: new Date(dynamoRecord.updatedAt),
  };
  delete dbRecord.granuleId;

  await t.context.dbClient('collections').insert(dbRecord);
});

test('put() updates a record in the database', async (t) => {
  const { collection, dbClient } = t.context;

  const request = {
    params: {
      name: collection.name,
      version: collection.version,
    },
    body: {
      ...collection,
      duplicateHandling: 'error',
    },
    testContext: { dbClient },
  };

  const response = buildFakeExpressResponse();

  await put(request, response);

  t.true(response.send.called);

  const dbRecord = await dbClient.first('duplicateHandling')
    .from('collections')
    .where({ name: collection.name, version: collection.version });

  t.is(dbRecord.duplicateHandling, 'error');
});

test('put() creates a record in the database if one does not exist', async (t) => {
  const { collectionsModel, dbClient } = t.context;

  const collection = fakeCollectionFactory({ duplicateHandling: 'replace' });

  await collectionsModel.create(collection);

  const request = {
    params: {
      name: collection.name,
      version: collection.version,
    },
    body: {
      ...collection,
      duplicateHandling: 'error',
    },
    testContext: { dbClient },
  };

  const response = buildFakeExpressResponse();

  await put(request, response);

  t.true(response.send.called);

  const dbRecord = await dbClient.first('duplicateHandling')
    .from('collections')
    .where({ name: collection.name, version: collection.version });

  t.not(dbRecord, undefined);
  t.is(dbRecord.duplicateHandling, 'error');
});

test('put() results in Dynamo and DB records with the same created_at and updated_at times', async (t) => {
  const { collection, collectionsModel, dbClient } = t.context;

  const request = {
    params: {
      name: collection.name,
      version: collection.version,
    },
    body: {
      ...collection,
      duplicateHandling: 'error',
    },
    testContext: { dbClient },
  };

  const response = buildFakeExpressResponse();

  await put(request, response);

  t.true(response.send.called);

  const dbRecord = await dbClient.table('collections')
    .first('created_at', 'updated_at')
    .where({ name: collection.name, version: collection.version });

  const dynamoRecord = await collectionsModel.get({
    name: collection.name,
    version: collection.version,
  });

  t.is(dbRecord.created_at.getTime(), dynamoRecord.createdAt);
  t.is(dbRecord.updated_at.getTime(), dynamoRecord.updatedAt);
});
