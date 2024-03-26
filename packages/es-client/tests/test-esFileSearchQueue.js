'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('../bootstrap');
const { ESFileQueue } = require('../esFileQueue');
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

// sort function to return granules in order that Elasticsearch will return them.
const sortByFileKey = (a, b) => (a.files[0].key < b.files[0].key ? -1 : 1);

const byBucketName = (bucket) => (granule) =>
  granule.files[0].bucket && granule.files[0].bucket === bucket;

test.serial(
  'esFileQueue.peek() returns the next item, but does not remove it from the queue.',
  async (t) => {
    let granules = granuleFactory(2);
    await loadGranules(granules, t);

    const targetBucket = granules[0].files[0].bucket;

    granules = granules.filter(byBucketName(targetBucket)).sort(sortByFileKey);

    const expected = {
      granuleId: granules[0].granuleId,
      ...granules[0].files[0],
    };

    const sq = new ESFileQueue({ bucket: targetBucket });

    t.deepEqual(expected, await sq.peek());
    t.deepEqual(expected, await sq.peek());
  }
);

test.serial(
  'esFileQueue.shift() returns the next item and removes it from the queue.',
  async (t) => {
    let granules = await granuleFactory(2, { bucket: randomId('bucket2') });
    await loadGranules(granules, t);

    granules = granules.sort(sortByFileKey);
    const expected0 = {
      granuleId: granules[0].granuleId,
      ...granules[0].files[0],
    };
    const expected1 = {
      granuleId: granules[1].granuleId,
      ...granules[1].files[0],
    };

    const bucket = granules[0].files[0].bucket;

    const sq = new ESFileQueue({ bucket });

    t.deepEqual(expected0, await sq.peek());
    t.deepEqual(expected0, await sq.shift());
    t.deepEqual(expected1, await sq.peek());
    t.deepEqual(expected1, await sq.shift());
    t.deepEqual(undefined, await sq.shift());
  }
);

test.serial('esFileQueue can handle paging.', async (t) => {
  const pageLengh = 3;
  process.env.ES_SCROLL_SIZE = pageLengh;
  const numGrans = 13;
  let granules = await granuleFactory(numGrans, { bucket: randomId('bucket2') });
  await loadGranules(granules, t);

  granules = granules.sort(sortByFileKey);

  const bucket = granules[0].files[0].bucket;

  const sq = new ESFileQueue({ bucket });
  const spiedSq = sandbox.spy(sq, 'fetchItems');

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
