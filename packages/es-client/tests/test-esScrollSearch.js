'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('../bootstrap');
const { Search } = require('../search');
const ESScrollSearch = require('../esScrollSearch');
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
  t.context.esClient = await new Search();
  t.context.cumulusEsClient = await t.context.esClient.getEsClient();
});

test.afterEach.always(async (t) => {
  sandbox.restore();
  await t.context.cumulusEsClient.indices.delete({ index: t.context.esIndex });
});

test.serial(
  'ESScrollSearch query returns number of hits equal to the ES_SCROLL_SIZE environment variable',
  async (t) => {
    const inputEsScrollSize = process.env.ES_SCROLL_SIZE;
    const testScrollSize = 4;
    const numGranules = 25;

    process.env.ES_SCROLL_SIZE = testScrollSize;

    try {
      const granules = granuleFactory(numGranules);
      await loadGranules(granules, t);
      const esScrollSearch = new ESScrollSearch(
        {},
        'granule',
        t.context.esAlias
      );

      let allResults = [];
      let results = await esScrollSearch.query();
      t.is(results.length, testScrollSize);

      const spy = sinon.spy(esScrollSearch.client, 'scroll');
      let calls = 0;
      /* eslint-disable no-await-in-loop */
      do {
        allResults = allResults.concat(results);
        results = await esScrollSearch.query();
        calls += 1;
      } while (results.length > 0);
      /* eslint-enable no-await-in-loop */
      t.is(allResults.length, numGranules);
      t.true(spy.called);
      t.is(spy.getCalls().length, calls);
    } catch (error) {
      console.log(error);
    } finally {
      process.env.ES_SCROLL_SIZE = inputEsScrollSize;
    }
  }
);
