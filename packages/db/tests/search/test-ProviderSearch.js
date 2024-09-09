'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { ProviderSearch } = require('../../dist/search/ProviderSearch');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  ProviderPgModel,
  fakeProviderRecordFactory,
  migrationDir,
} = require('../../dist');

const testDbName = `provider_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.providerPgModel = new ProviderPgModel();
  const providers = [];
  t.context.providerSearchTmestamp = 1579352700000;

  range(100).map((num) => (
    providers.push(fakeProviderRecordFactory({
      cumulus_id: num,
      updated_at: new Date(t.context.providerSearchTmestamp + (num % 2)),
      created_at: new Date(t.context.providerSearchTmestamp - (num % 2)),
      name: num % 2 === 0 ? `testProvider${num}` : `fakeProvider${num}`,
      host: num % 2 === 0 ? 'cumulus-sit' : 'cumulus-uat',
      global_connection_limit: num % 2 === 0 ? 0 : 10,
      private_key: num % 2 === 0 ? `fakeKey${num}` : undefined,
    }))
  ));

  await t.context.providerPgModel.insert(
    t.context.knex,
    providers
  );
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('ProviderSearch returns 10 providers by default', async (t) => {
  const { knex } = t.context;
  const dbSearch = new ProviderSearch({});
  const results = await dbSearch.query(knex);
  t.is(results.meta.count, 100);
  t.is(results.results.length, 10);
});

test('ProviderSearch supports page and limit params', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 20,
    page: 2,
  };
  let dbSearch = new ProviderSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    limit: 11,
    page: 10,
  };
  dbSearch = new ProviderSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new ProviderSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 0);
});

test('ProviderSearch supports infix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 20,
    infix: 'test',
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 20);
  t.true(response.results?.every((provider) => provider.id.includes('test')));
});

test('ProviderSearch supports prefix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 20,
    prefix: 'fake',
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 20);
  t.true(response.results?.every((provider) => provider.id.startsWith('fake')));
});

test('ProviderSearch supports term search for date field', async (t) => {
  const { knex } = t.context;
  const testUpdatedAt = t.context.providerSearchTmestamp + 1;
  const queryStringParameters = {
    limit: 200,
    updatedAt: `${testUpdatedAt}`,
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results?.every((provider) => provider.updatedAt === testUpdatedAt));
});

test('ProviderSearch supports term search for number field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    globalConnectionLimit: '10',
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results?.every((provider) => provider.globalConnectionLimit === 10));
});

test('ProviderSearch supports term search for string field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    host: 'cumulus-sit',
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results?.every((provider) => provider.host === 'cumulus-sit'));
});

test('ProviderSearch supports range search', async (t) => {
  const { knex } = t.context;
  const timestamp1 = t.context.providerSearchTmestamp + 1;
  const timestamp2 = t.context.providerSearchTmestamp + 2;
  const queryStringParameters = {
    limit: 200,
    timestamp__from: `${timestamp1}`,
    timestamp__to: `${timestamp2}`,
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results?.every((provider) => provider.updatedAt >= timestamp1
    && provider.updatedAt <= timestamp2));
});

test('ProviderSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    id: 'testProvider82',
    host: 'cumulus-sit',
    global_connection_limit: 0,
  };

  const expectedResponse = {
    createdAt: 1579352700000,
    host: 'cumulus-sit',
    id: 'testProvider82',
    globalConnectionLimit: 0,
    privateKey: 'fakeKey82',
    protocol: 's3',
    updatedAt: 1579352700000,
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
  t.deepEqual(response.results[0], expectedResponse);
});

test('ProviderSearch non-existing fields are ignored', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
});

test('ProviderSearch returns fields specified', async (t) => {
  const { knex } = t.context;
  let fields = 'id';
  let queryStringParameters = {
    fields,
  };
  let dbSearch = new ProviderSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 10);
  response.results.forEach((provider) => t.deepEqual(Object.keys(provider), fields.split(',')));

  fields = 'id,host,globalConnectionLimit';
  queryStringParameters = {
    fields,
  };
  dbSearch = new ProviderSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 10);
  response.results.forEach((provider) => t.deepEqual(Object.keys(provider), fields.split(',')));
});

test('ProviderSearch supports sorting', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    sort_by: 'id',
    order: 'asc',
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  t.true(response.results[0].id < response.results[99].id);
  t.true(response.results[0].id < response.results[50].id);

  queryStringParameters = {
    limit: 200,
    sort_key: ['-id'],
  };
  const dbSearch2 = new ProviderSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 100);
  t.is(response2.results?.length, 100);
  t.true(response2.results[0].id > response2.results[99].id);
  t.true(response2.results[0].id > response2.results[50].id);

  queryStringParameters = {
    limit: 200,
    sort_by: 'globalConnectionLimit',
  };
  const dbSearch3 = new ProviderSearch({ queryStringParameters });
  const response3 = await dbSearch3.query(knex);
  t.is(response3.meta.count, 100);
  t.is(response3.results?.length, 100);
  t.true(response3.results[0].globalConnectionLimit < response3.results[99].globalConnectionLimit);
  t.true(response3.results[49].globalConnectionLimit < response3.results[50].globalConnectionLimit);
});

test('ProviderSearch supports terms search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    id__in: ['fakeProvider85', 'testProvider86'].join(','),
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);
  t.true(response.results?.every((provider) => ['fakeProvider85', 'testProvider86'].includes(provider.id)));
});

test('ProviderSearch supports search when provider field does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    host__not: 'cumulus-uat',
  };
  let dbSearch = new ProviderSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results?.every((provider) => provider.host !== 'cumulus-uat'));

  queryStringParameters = {
    limit: 200,
    host__not: 'cumulus-uat',
    id__not: 'testProvider38',
  };
  dbSearch = new ProviderSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
  t.true(response.results?.every((provider) => provider.host !== 'cumulus-uat' && provider.id !== 'testProvider38'));
});

test('ProviderSearch supports search which checks existence of provider field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    privateKey__exists: 'true',
  };
  const dbSearch = new ProviderSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results?.every((provider) => provider.privateKey));
});
