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
  range(100).map((num) => (
    collections.push(fakeCollectionRecordFactory({
      name: num % 2 === 0 ? `testCollection___00${num}` : `fakeCollection___00${num}`,
      version: `${num}`,
      cumulus_id: num,
      updated_at: new Date(1579352700000 + (num % 2) * 1000),
      process: num % 2 === 0 ? 'ingest' : 'publish',
      report_to_ems: num % 2 === 0,
      url_path: num % 2 === 0 ? 'https://fakepath.com' : undefined,
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

test('CollectionSearch supports page and limit params', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 20,
    page: 2,
  };
  let dbSearch = new CollectionSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    limit: 11,
    page: 10,
  };
  dbSearch = new CollectionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new CollectionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 0);
});

test('CollectionSearch returns correct response for basic query', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new CollectionSearch();
  const results = await AggregateSearch.query(knex);
  t.is(results.meta.count, 100);
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
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    limit: 20,
    prefix: 'fake',
  };
  const dbSearch2 = new CollectionSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 50);
  t.is(response2.results?.length, 20);
});

test('CollectionSearch supports term search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    version: 2,
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    limit: 200,
    name: 'fakeCollection___0071',
  };
  const dbSearch2 = new CollectionSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 1);
  t.is(response2.results?.length, 1);

  queryStringParameters = {
    limit: 200,
    process: 'publish',
  };
  const dbSearch3 = new CollectionSearch({ queryStringParameters });
  const response3 = await dbSearch3.query(knex);
  t.is(response3.meta.count, 50);
  t.is(response3.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    reportToEms: false,
  };
  const dbSearch4 = new CollectionSearch({ queryStringParameters });
  const response4 = await dbSearch4.query(knex);
  t.is(response4.meta.count, 50);
  t.is(response4.results?.length, 50);
});

test('CollectionSearch supports term search for date field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    updatedAt: 1579352701000,
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

// TODO in CUMULUS-3639
test.todo('CollectionSearch supports range search');

test('CollectionSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    name: 'testCollection___000',
    updatedAt: 1579352700000,
    process: 'ingest',
    reportToEms: 'true',
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('CollectionSearch supports sorting', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    sort_by: 'name',
    order: 'asc',
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  t.true(response.results[0].name < response.results[99].name);
  t.true(response.results[0].name < response.results[50].name);

  queryStringParameters = {
    limit: 200,
    sort_key: ['-name'],
  };
  const dbSearch2 = new CollectionSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 100);
  t.is(response2.results?.length, 100);
  t.true(response2.results[0].name > response2.results[99].name);
  t.true(response2.results[0].name > response2.results[50].name);

  queryStringParameters = {
    limit: 200,
    sort_by: 'version',
  };
  const dbSearch3 = new CollectionSearch({ queryStringParameters });
  const response3 = await dbSearch3.query(knex);
  t.is(response3.meta.count, 100);
  t.is(response3.results?.length, 100);
  t.true(response3.results[0].version < response3.results[99].version);
  t.true(response3.results[49].version < response3.results[50].version);
});

test('CollectionSearch supports terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    process__in: ['ingest', 'archive'].join(','),
  };
  let dbSearch = new CollectionSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    process__in: ['ingest', 'archive'].join(','),
    name__in: ['testCollection___000', 'fakeCollection___001'].join(','),
  };
  dbSearch = new CollectionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('CollectionSearch supports search which granule field does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    process__not: 'publish',
  };
  let dbSearch = new CollectionSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    process__not: 'publish',
    name__not: 'testCollection___000',
  };
  dbSearch = new CollectionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
});

test('CollectionSearch supports search which checks existence of granule field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    urlPath__exists: 'true',
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});
