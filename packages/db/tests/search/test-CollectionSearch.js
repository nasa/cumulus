'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { CollectionSearch } = require('../../dist/search/CollectionSearch');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  migrationDir,
} = require('../../dist');

const testDbName = `collection_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  const collections = [];

  range(40).map((num) => (
    collections.push(fakeCollectionRecordFactory({
      name: num % 2 === 0 ? 'testCollection' : 'fakeCollection',
      version: `${num}`,
      cumulus_id: num,
      updated_at: new Date(1579352700000 + (num % 2) * 1000),
    }))
  ));

  await t.context.collectionPgModel.insert(
    t.context.knex,
    collections
  );
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('CollectionSearch returns correct response for basic query', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new CollectionSearch();
  const results = await AggregateSearch.query(knex);
  t.is(results.meta.count, 40);
  t.is(results.results.length, 10);
});

test('CollectionSearch supports infix and prefix search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 20,
    infix: 'test',
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 20);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    limit: 20,
    prefix: 'fake',
  };
  const dbSearch2 = new CollectionSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 20);
  t.is(response2.results?.length, 20);
});
