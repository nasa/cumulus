'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');
const isEqual = require('lodash/isEqual');
const orderBy = require('lodash/orderBy');
const { bootstrapElasticSearch } = require('../bootstrap');
const { Search } = require('../search');
const ESSearchAfter = require('../esSearchAfter');
const { loadGranules, granuleFactory } = require('./helpers/helpers');

const sandbox = sinon.createSandbox();

test.before(() => {
  process.env.NODE_ENV = 'test';
});

test.beforeEach(async (t) => {
  t.context.esAlias = randomId('esalias');
  t.context.esIndex = randomId('esindex');
  process.env.ES_INDEX = t.context.esAlias;
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: t.context.esIndex,
    alias: t.context.esAlias,
  });
  t.context.esClient = new Search();
  t.context.cumulusEsClient = await t.context.esClient.getEsClient();
});

test.afterEach.always(async (t) => {
  sandbox.restore();
  await t.context.cumulusEsClient.indices.delete({ index: t.context.esIndex });
});

test.after.always(() => {
  delete process.env.NODE_ENV;
});

test.serial('ESSearchAfter query can list all hits', async (t) => {
  const testSearchSize = 4;
  const numGranules = 25;
  const expectedCallsWithTestSearchSize = Math.floor(numGranules / testSearchSize);

  const granules = granuleFactory(numGranules);
  const granuleIds = granules.map((g) => g.granuleId);
  await loadGranules(granules, t);
  let esSearchAfter = new ESSearchAfter(
    { queryStringParameters: {
      limit: testSearchSize,
    } },
    'granule',
    t.context.esAlias
  );
  let allResults = [];
  const client = await ESSearchAfter.es();
  esSearchAfter.client = client;
  const spy = sandbox.spy(client, 'search');
  let calls = 0;
  let response;
  /* eslint-disable no-await-in-loop */
  do {
    response = await esSearchAfter.query();
    if (response.results.length > 0) {
      t.truthy(response.meta.searchContext);
    }
    allResults = allResults.concat(response.results);
    esSearchAfter = new ESSearchAfter(
      { queryStringParameters: {
        limit: testSearchSize,
        searchContext: decodeURIComponent(response.meta.searchContext),
      } },
      'granule',
      t.context.esAlias
    );
    esSearchAfter.client = client;
    if (calls < expectedCallsWithTestSearchSize) {
      t.is(response.results.length, testSearchSize);
    } else if (calls === expectedCallsWithTestSearchSize) {
      t.is(response.results.length, (numGranules % testSearchSize));
    } else {
      t.is(response.results.length, 0);
    }
    calls += 1;
  } while (response.results.length > 0);
  /* eslint-enable no-await-in-loop */
  const resultGranuleIds = allResults.map((g) => g.granuleId);
  t.is(allResults.length, numGranules);
  t.true(spy.called);
  t.is(spy.getCalls().length, calls);
  t.is(calls, Math.ceil(numGranules / testSearchSize) + 1);
  t.true(isEqual(granuleIds.sort(), resultGranuleIds.sort()));
});

test.serial(
  'ESSearchAfter lists all hits with same timestamp across multiple queries with correct sortParams',
  async (t) => {
    const testSearchSize = 1;
    const numGranules = 10;

    const timestamp = Date.now();
    const granules = granuleFactory(numGranules, {}, {
      createdAt: timestamp,
      updatedAt: timestamp,
      timestamp,
    });
    console.log('granules', granules);
    const granuleIds = granules.map((g) => g.granuleId);
    await loadGranules(granules, t);

    let esSearchAfter = new ESSearchAfter(
      { queryStringParameters: {
        limit: testSearchSize,
      } },
      'granule',
      t.context.esAlias
    );
    let response;
    let allResults = [];
    /* eslint-disable no-await-in-loop */
    do {
      response = await esSearchAfter.query();
      allResults = allResults.concat(response.results);
      esSearchAfter = new ESSearchAfter(
        { queryStringParameters: {
          limit: testSearchSize,
          searchContext: decodeURIComponent(response.meta.searchContext),
        } },
        'granule',
        t.context.esAlias
      );
    } while (response.results.length > 0);
    /* eslint-enable no-await-in-loop */
    const resultGranuleIds = allResults.map((g) => g.granuleId);
    t.true(isEqual(granuleIds.sort(), resultGranuleIds.sort()));
  }
);

test.serial('Search_after with sort_key returns correctly ordered granules', async (t) => {
  const testSearchSize = 5;
  const numGranules = 10;

  const timestamp = Date.now();
  const granules = granuleFactory(numGranules, {}, {
    createdAt: timestamp,
    updatedAt: timestamp,
    timestamp,
  });
  console.log('granules', granules);
  const sortedGranules = orderBy(granules, ['collectionId', 'status', 'granuleId'], ['desc', 'asc', 'asc']);
  await loadGranules(granules, t);

  const params = {
    limit: testSearchSize,
    page: 1,
    sort_key: ['-collectionId', '+status', 'granuleId'],
  };

  const es = new ESSearchAfter(
    { queryStringParameters: params },
    'granule',
    process.env.ES_INDEX
  );

  const queryResult = await es.query();
  t.is(queryResult.meta.count, 10);
  t.is(queryResult.results.length, 5);
  const firstPage = queryResult.results;

  const secondEs = new ESSearchAfter(
    { queryStringParameters: {
      ...params,
      searchContext: decodeURIComponent(queryResult.meta.searchContext),
    } },
    'granule',
    process.env.ES_INDEX
  );
  const secondResult = await secondEs.query();
  t.is(queryResult.meta.count, 10);
  t.is(queryResult.results.length, 5);
  const allResults = firstPage.concat(secondResult.results);
  t.deepEqual(allResults.map((g) => g.granuleId), sortedGranules.map((g) => g.granuleId));
});

test.serial('Search with sort_by and order returns correctly ordered granules', async (t) => {
  const testSearchSize = 5;
  const numGranules = 10;

  const timestamp = Date.now();
  const granules = granuleFactory(numGranules, {}, {
    createdAt: timestamp,
    updatedAt: timestamp,
    timestamp,
  });
  console.log('granules', granules);
  const sortedGranules = orderBy(granules, ['granuleId'], ['desc']);
  await loadGranules(granules, t);

  const params = {
    limit: testSearchSize,
    page: 1,
    sort_by: 'granuleId',
    order: 'desc',
  };

  const es = new ESSearchAfter(
    { queryStringParameters: params },
    'granule',
    process.env.ES_INDEX
  );

  const queryResult = await es.query();
  t.is(queryResult.meta.count, 10);
  t.is(queryResult.results.length, 5);
  const firstPage = queryResult.results;

  const secondEs = new ESSearchAfter(
    { queryStringParameters: {
      ...params,
      searchContext: decodeURIComponent(queryResult.meta.searchContext),
    } },
    'granule',
    process.env.ES_INDEX
  );
  const secondResult = await secondEs.query();
  t.is(queryResult.meta.count, 10);
  t.is(queryResult.results.length, 5);
  const allResults = firstPage.concat(secondResult.results);
  t.deepEqual(allResults.map((g) => g.granuleId), sortedGranules.map((g) => g.granuleId));
});
