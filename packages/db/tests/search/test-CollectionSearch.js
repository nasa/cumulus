'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { CollectionSearch } = require('../../dist/search/CollectionSearch');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  CollectionPgModel,
  GranulePgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
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
      name: num % 2 === 0 ? 'testCollection' : 'fakeCollection',
      version: num,
      cumulus_id: num,
      updated_at: new Date(1579352700000 + (num % 2) * 1000),
      process: num % 2 === 0 ? 'ingest' : 'publish',
      report_to_ems: num % 2 === 0,
      url_path: num % 2 === 0 ? 'https://fakepath.com' : undefined,
    }))
  ));

  t.context.granulePgModel = new GranulePgModel();
  const granules = [];
  const statuses = ['queued', 'failed', 'completed', 'running'];

  range(999).map((num) => (
    granules.push(fakeGranuleRecordFactory({
      collection_cumulus_id: num % 100,
      status: statuses[num % 4],
    }))
  ));

  await t.context.collectionPgModel.insert(
    t.context.knex,
    collections
  );

  await t.context.granulePgModel.insert(
    t.context.knex,
    granules
  );
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('CollectionSearch returns 10 collections by default', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new CollectionSearch();
  const results = await AggregateSearch.query(knex);
  t.is(results.meta.count, 100);
  t.is(results.results.length, 10);
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

test('CollectionSearch supports infix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 20,
    infix: 'test',
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 20);
});

test('CollectionSearch supports prefix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 20,
    prefix: 'fake',
  };
  const dbSearch2 = new CollectionSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 50);
  t.is(response2.results?.length, 20);
});

test('CollectionSearch supports term search for boolean field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
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

test('CollectionSearch supports term search for number field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    version: 2,
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('CollectionSearch supports term search for string field', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    _id: 'fakeCollection___71',
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
});

// TODO in CUMULUS-3639
test.todo('CollectionSearch supports range search');

test('CollectionSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    name: 'testCollection',
    version: 0,
    updatedAt: 1579352700000,
    process: 'ingest',
    reportToEms: 'true',
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('CollectionSearch non-existing fields are ignored', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
});

test('CollectionSearch returns fields specified', async (t) => {
  const { knex } = t.context;
  const fields = 'name,version,reportToEms,process';
  const queryStringParameters = {
    fields,
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 10);
  response.results.forEach((collection) => t.deepEqual(Object.keys(collection), fields.split(',')));
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
    _id__in: ['testCollection___0', 'fakeCollection___1'].join(','),
  };
  dbSearch = new CollectionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('CollectionSearch supports search when collection field does not match the given value', async (t) => {
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
    version__not: 18,
  };
  dbSearch = new CollectionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
});

test('CollectionSearch supports search which checks existence of collection field', async (t) => {
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

test('CollectionSearch supports includeStats', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    includeStats: true,
  };
  const dbSearch = new CollectionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  t.is(typeof response.results[0].stats.failed, 'number');
  t.is(typeof response.results[0].stats.completed, 'number');
  t.is(typeof response.results[0].stats.running, 'number');
  t.is(typeof response.results[0].stats.queued, 'number');
  t.is(typeof response.results[0].stats.total, 'number');
  t.is(response.results[0].stats.failed >= 0, true);
  t.is(response.results[0].stats.completed >= 0, true);
  t.is(response.results[0].stats.running >= 0, true);
  t.is(response.results[0].stats.queued >= 0, true);
  t.is(response.results[0].stats.total > 0, true);
});
