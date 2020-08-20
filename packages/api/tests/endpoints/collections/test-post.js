'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { knex } = require('@cumulus/db');
const S3 = require('@cumulus/aws-client/S3');
const CollectionsModel = require('../../../models/collections');
const RulesModel = require('../../../models/rules');
const { post } = require('../../../endpoints/collections');
const { fakeCollectionFactory } = require('../../../lib/testUtils');

const randomString = (length = 10) => cryptoRandomString({ length });

const buildFakeExpressResponse = () => {
  let boomBadImplementationMessage;
  let boomBadRequestMessage;
  let sendBody;

  return {
    boom: {
      badImplementation: (message) => {
        boomBadImplementationMessage = message;
      },
      badRequest: (message) => {
        boomBadRequestMessage = message;
      },
    },
    send: (body) => {
      sendBody = body;
    },
    getSendBody: () => sendBody,
    getBoomBadImplementationMessage: () => boomBadImplementationMessage,
    getBoomBadRequestMessage: () => boomBadRequestMessage,
  };
};

test.before(async (t) => {
  process.env.system_bucket = randomString();

  process.env.CollectionsTable = randomString();
  t.context.collectionsModel = new CollectionsModel();

  process.env.RulesTable = randomString();
  const rulesModel = new RulesModel();

  await Promise.all([
    S3.createBucket(process.env.system_bucket),
    t.context.collectionsModel.createTable(),
    rulesModel.createTable(),
  ]);

  t.context.dbClient = knex.createLocalStackClient();

  t.context.nullLogger = {
    error: () => undefined,
  };
});

test.beforeEach((t) => {
  t.context.collection = fakeCollectionFactory();
});

test('post() writes a record to the database', async (t) => {
  const { collection, dbClient } = t.context;

  const request = {
    body: collection,
    context: { dbClient },
  };

  const response = buildFakeExpressResponse();

  await post(request, response);

  t.is(response.getSendBody().message, 'Record saved');

  const dbRecords = await dbClient.select('name', 'version')
    .from('collections')
    .where({ name: collection.name, version: collection.version });

  t.is(dbRecords.length, 1);
});

test('post() does not write to the database if writing to Dynamo fails', async (t) => {
  const { collection, dbClient, nullLogger } = t.context;

  const fakeCollectionsModel = {
    exists: () => false,
    create: () => {
      throw new Error('something bad');
    },
  };

  const request = {
    body: collection,
    context: {
      dbClient,
      collectionsModel: fakeCollectionsModel,
      logger: nullLogger,
    },
  };

  const response = buildFakeExpressResponse();

  await post(request, response);

  t.not(response.getBoomBadImplementationMessage(), undefined);
  t.true(
    response.getBoomBadImplementationMessage().includes('something bad'),
    `Actual error message: ${response.getBoomBadImplementationMessage()}`
  );

  const dbRecords = await dbClient.select('name', 'version')
    .from('collections')
    .where({ name: collection.name, version: collection.version });

  t.is(dbRecords.length, 0);
});

test('post() does not write to Dynamo if writing to the database fails', async (t) => {
  const { collection, collectionsModel, nullLogger } = t.context;

  const fakeDbClient = () => ({
    insert: () => Promise.reject(new Error('something bad')),
  });

  const request = {
    body: collection,
    context: {
      dbClient: fakeDbClient,
      logger: nullLogger,
    },
  };

  const response = buildFakeExpressResponse();

  await post(request, response);

  t.not(response.getBoomBadImplementationMessage(), undefined);
  t.true(
    response.getBoomBadImplementationMessage().includes('something bad'),
    `Actual error message: ${response.getBoomBadImplementationMessage()}`
  );

  t.false(await collectionsModel.exists(collection.name, collection.version));
});

test('post() results in Dynamo and DB records with the same created_at and updated_at times', async (t) => {
  const { collection, collectionsModel, dbClient } = t.context;

  const request = {
    body: collection,
    context: { dbClient },
  };

  const response = buildFakeExpressResponse();

  await post(request, response);

  t.is(response.getSendBody().message, 'Record saved');

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
