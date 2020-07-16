'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');
const { ESSearchQueue } = require('../../es/esSearchQueue');
const { Search } = require('../../es/search');
const { granuleFactory, loadGranules } = require('./helpers/helpers');

const sandbox = sinon.createSandbox();

test.beforeEach(async (t) => {
  t.context.esAlias = randomId('esalias');
  t.context.esIndex = randomId('esindex');
  process.env.ES_INDEX = t.context.esAlias;
  await bootstrapElasticSearch(
    'fakehost',
    t.context.esIndex,
    t.context.esAlias
  );
  t.context.esClient = await Search.es();
  t.context.esClientSpy = sinon.spy(t.context.esClient, 'scroll');
});

test.afterEach.always(async (t) => {
  sandbox.restore();
  await t.context.esClient.indices.delete({ index: t.context.esIndex });
});

test.serial(
  'esSearchQueue.peek() returns the next item, but does not remove it from the queue.',
  async (t) => {
    const grans = granuleFactory(10);
    await loadGranules(grans, t);

    const expected = grans[0];

    const sq = new ESSearchQueue({ order: 'asc' }, 'granule');

    const peeked = await sq.peek();
    expected.timestamp = peeked.timestamp;
    t.deepEqual(expected, peeked);
    t.deepEqual(expected, await sq.peek());
  }
);

test.serial(
  'esSearchQueue.shift() returns the next item and removes it from the queue and returns undefined when empty.',
  async (t) => {
    const grans = granuleFactory(2);
    await loadGranules(grans, t);

    const firstExpected = grans[0];
    const secondExpected = grans[1];

    const sq = new ESSearchQueue({ order: 'asc' }, 'granule');
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

test.serial('esFileQueue can handle paging.', async (t) => {
  const pageLengh = 3;
  process.env.ES_SCROLL_SIZE = pageLengh;
  const numGrans = 13;
  const grans = granuleFactory(numGrans);
  await loadGranules(grans, t);

  const sq = new ESSearchQueue({ order: 'asc' }, 'granule');
  const spiedSq = sinon.spy(sq, '_fetchItems');

  const fetched = [];

  t.false(t.context.esClientSpy.called);

  /* eslint-disable no-await-in-loop */
  while (await sq.peek()) {
    fetched.push(await sq.shift());
  }
  /* eslint-enable no-await-in-loop */

  t.true(spiedSq.getCalls().length >= numGrans / pageLengh);
  t.is(fetched.length, numGrans);
  delete process.env.ES_SCROLL_SIZE;
});
