'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('../bootstrap');
const { ESSearchQueue } = require('../esSearchQueue');
const { EsClient, Search } = require('../search');
const { granuleFactory, loadGranules } = require('./helpers/helpers');

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
  t.context.search = new Search();
  await t.context.search.initializeEsClient();
  t.context.esClient = new EsClient();
  await t.context.esClient.initializeEsClient();
});

test.afterEach.always(async (t) => {
  sandbox.restore();
  await t.context.esClient.client.indices.delete({ index: t.context.esIndex });
});

test.serial(
  'esSearchQueue.peek() returns the next item, but does not remove it from the queue.',
  async (t) => {
    const granules = granuleFactory(10);
    await loadGranules(granules, t);

    const expected = granules[9];

    const sq = new ESSearchQueue({}, 'granule');

    const peeked = await sq.peek();
    expected.timestamp = peeked.timestamp;
    t.deepEqual(expected, peeked);
    t.deepEqual(expected, await sq.peek());
  }
);

test.serial(
  'esSearchQueue.shift() returns the next item and removes it from the queue and returns undefined when empty.',
  async (t) => {
    const granules = granuleFactory(2);
    await loadGranules(granules, t);

    const firstExpected = granules[1];
    const secondExpected = granules[0];

    const sq = new ESSearchQueue({}, 'granule');
    let peeked = await sq.peek();
    firstExpected.timestamp = peeked.timestamp;

    t.deepEqual(firstExpected, await sq.peek());
    t.deepEqual(firstExpected, await sq.shift());

    peeked = await sq.peek();
    secondExpected.timestamp = peeked.timestamp;
    t.deepEqual(secondExpected, await sq.peek());
    t.deepEqual(secondExpected, await sq.shift());
    t.deepEqual(undefined, await sq.shift());
  }
);

test.serial('esSearchQueue handles paging.', async (t) => {
  const pageLengh = 3;
  process.env.ES_SCROLL_SIZE = pageLengh;
  const numGranules = 13;
  const granules = granuleFactory(numGranules);
  await loadGranules(granules, t);

  const sq = new ESSearchQueue({}, 'granule');
  const spiedSq = sandbox.spy(sq, '_fetchItems');
  const esClientSpy = sandbox.spy(t.context.search._esClient._client, 'scroll');

  const fetched = [];

  t.false(esClientSpy.called);

  /* eslint-disable no-await-in-loop */
  while (await sq.peek()) {
    fetched.push(await sq.shift());
  }
  /* eslint-enable no-await-in-loop */

  t.true(spiedSq.getCalls().length >= numGranules / pageLengh);
  t.is(fetched.length, numGranules);
  delete process.env.ES_SCROLL_SIZE;
});
