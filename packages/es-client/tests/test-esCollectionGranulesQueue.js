'use strict';

const test = require('ava');
const sinon = require('sinon');

const { randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { bootstrapElasticSearch } = require('../bootstrap');
const { ESCollectionGranuleQueue } = require('../esCollectionGranuleQueue');
const { Search } = require('../search');
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
  t.context.esClient = await new Search();
  t.context.cumulusEsClient = await t.context.esClient.getEsClient();
  t.context.esClientSpy = sandbox.spy(t.context.cumulusEsClient, 'scroll');
});

test.afterEach.always(async (t) => {
  sandbox.restore();
  await t.context.cumulusEsClient.indices.delete({ index: t.context.esIndex });
});

const sortByGranuleId = (a, b) => (a.granuleId < b.granuleId ? -1 : 1);

test.serial(
  'esCollectionGranuleQueue.peek() returns the first item, but does not remove it from the queue.',
  async (t) => {
    const granules = granuleFactory(10);
    await loadGranules(granules, t);

    // expect the first out to be sorted.
    granules.sort(sortByGranuleId);
    const expected = granules[0];
    const collectionId = granules[0].collectionId;

    const sq = new ESCollectionGranuleQueue({ collectionId });

    const peeked = await sq.peek();
    expected.timestamp = peeked.timestamp;
    t.deepEqual(expected, peeked);
    t.deepEqual(expected, await sq.peek());
  }
);

test.serial(
  'esCollectionGranuleQueue.shift() returns the next item and removes it from the queue and returns undefined when empty.',
  async (t) => {
    const collectionId = constructCollectionId(randomId('collection'), 1);
    const granules = granuleFactory(2, undefined, { collectionId });
    await loadGranules(granules, t);

    // expect them to be sorted.
    granules.sort(sortByGranuleId);
    const firstExpected = granules[0];
    const secondExpected = granules[1];

    const sq = new ESCollectionGranuleQueue({ collectionId });
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

test.serial(
  'esCollectionGranuleQueue returns the granules sorted by granuleId.',
  async (t) => {
    const collectionId = constructCollectionId(randomId('collection'), 1);
    const granules = granuleFactory(20, undefined, { collectionId });
    await loadGranules(granules, t);

    granules.sort(sortByGranuleId);
    const sq = new ESCollectionGranuleQueue({ collectionId });

    const fetched = [];

    /* eslint-disable no-await-in-loop */
    while (await sq.peek()) {
      fetched.push(await sq.shift());
    }
    /* eslint-enable no-await-in-loop */

    t.is(fetched.length, 20);
    t.deepEqual(
      granules.map((g) => g.granuleId),
      fetched.map((f) => f.granuleId)
    );
  }
);
