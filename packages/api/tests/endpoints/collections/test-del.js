'use strict';

const pick = require('lodash/pick');
const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const db = require('@cumulus/db');
const S3 = require('@cumulus/aws-client/S3');
const Collection = require('../../../models/collections');
const RulesModel = require('../../../models/rules');
const { del } = require('../../../endpoints/collections');
const { fakeCollectionFactory } = require('../../../lib/testUtils');
const { buildFakeExpressResponse } = require('../utils');

test.before(async (t) => {
  process.env.system_bucket = randomString();

  process.env.CollectionsTable = randomString();
  t.context.collectionsModel = new Collection();

  process.env.RulesTable = randomString();
  const rulesModel = new RulesModel();

  await Promise.all([
    S3.createBucket(process.env.system_bucket),
    t.context.collectionsModel.createTable(),
    rulesModel.createTable(),
  ]);

  t.context.dbClient = await db.connection.knex();
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

test('del() deletes a record from the database', async (t) => {
  const { collection, dbClient } = t.context;

  const request = {
    params: {
      name: collection.name,
      version: collection.version,
    },
    testContext: { dbClient },
  };

  const response = buildFakeExpressResponse();

  await del(request, response);

  t.true(response.send.calledWithMatch({ message: 'Record deleted' }));

  const dbRecord = await dbClient.first()
    .from('collections')
    .where(pick(collection, ['name', 'version']));

  t.is(dbRecord, undefined);
});

test('del() succeeds if there is not a matching record in the database', async (t) => {
  const { collectionsModel, dbClient } = t.context;

  const collection = fakeCollectionFactory();

  await collectionsModel.create(collection);

  const request = {
    params: {
      name: collection.name,
      version: collection.version,
    },
    testContext: { dbClient },
  };

  const response = buildFakeExpressResponse();

  await del(request, response);

  t.true(response.send.calledWithMatch({ message: 'Record deleted' }));
});
