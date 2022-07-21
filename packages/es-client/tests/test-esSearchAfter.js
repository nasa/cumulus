'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');
const isEqual = require('lodash/isEqual');
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
  t.context.esClient = await Search.es();
});

test.afterEach.always(async (t) => {
  sandbox.restore();
  await t.context.esClient.indices.delete({ index: t.context.esIndex });
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
        searchContext: response.meta.searchContext,
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
          searchContext: response.meta.searchContext,
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
