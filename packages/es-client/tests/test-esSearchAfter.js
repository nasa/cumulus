'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');
const { isEqual } = require('lodash');
const { bootstrapElasticSearch } = require('../bootstrap');
const { Search } = require('../search');
const ESSearchAfter = require('../esSearchAfter');
const { loadGranules, granuleFactory } = require('./helpers/helpers');

const sandbox = sinon.createSandbox();

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

test.serial(
  'ESSearchAfter query can list all hits',
  async (t) => {
    const testSearchSize = 4;
    const numGranules = 25;

    try {
      const granules = granuleFactory(numGranules);
      const granuleIds = granules.map((g) => g.granuleId);
      await loadGranules(granules, t);
      const esSearchAfter = new ESSearchAfter(
        { queryStringParameters: {
          limit: testSearchSize
        }},
        'granule',
        t.context.esAlias
      );

      let allResults = [];
      let { meta, results } = await esSearchAfter.query();
      t.truthy(meta.searchContext);
      t.is(results.length, testSearchSize);

      const spy = sinon.spy(esSearchAfter.client, 'search');
      let calls = 0;
      /* eslint-disable no-await-in-loop */
      do {
        allResults = allResults.concat(results);
        ({ meta, results } = await esSearchAfter.query(meta.searchContext));
        calls += 1;
      } while (results.length > 0);
      /* eslint-enable no-await-in-loop */
      resultGranuleIds = allResults.map((g) => g.granuleId);
      t.is(allResults.length, numGranules);
      t.true(spy.called);
      t.is(spy.getCalls().length, calls);
      t.true(isEqual(granuleIds, resultGranuleIds));
    } catch (error) {
      console.log(JSON.stringify(error));
    }
  }
);
