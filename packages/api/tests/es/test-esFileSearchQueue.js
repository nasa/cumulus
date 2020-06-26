'use strict';

const test = require('ava');
const sinon = require('sinon');
const range = require('lodash/range');
const { randomId } = require('@cumulus/common/test-utils');
const indexer = require('../../es/indexer');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');
const { ESFileSearchQueue } = require('../../es/esFileSearchQueue');
const { Search } = require('../../es/search');

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
});

test.afterEach.always(async (t) => {
  sandbox.restore();
  await t.context.esClient.indices.delete({ index: t.context.esIndex });
});

const granuleFactory = (number = 1, opts) =>
  range(number).map(() => {
    const bucket = randomId('bucket');
    const filename = randomId('filename');
    const key = `${randomId('path')}/${filename}`;
    const factOpts = { bucket, filename, key, ...opts };
    return fakeGranuleFactoryV2({ files: [factOpts] });
  });

const loadGranules = async (granules, t) => {
  await Promise.all(
    granules.map((g) =>
      indexer.indexGranule(t.context.esClient, g, t.context.esAlias)
    )
  );
};

const sortByFileKey = (a, b) => (a.files[0].key < b.files[0].key ? -1 : 1);

const byBucketName = (bucket) => (granule) =>
  granule.files[0].bucket && granule.files[0].bucket === bucket;

test.serial(
  'esFileSearchQueue.peek() returns the next item, but does not remove it from the queue.',
  async (t) => {
    let grans = granuleFactory(2);
    await loadGranules(grans, t);

    const targetBucket = grans[0].files[0].bucket;

    grans = grans.filter(byBucketName(targetBucket)).sort(sortByFileKey);

    const expected = {
      granuleId: grans[0].granuleId,
      ...grans[0].files[0],
    };

    const sq = new ESFileSearchQueue({ bucket: targetBucket });

    t.deepEqual(expected, await sq.peek());
    t.deepEqual(expected, await sq.peek());
  }
);

test.serial(
  'esFileSearchQueue.shift() returns the next item and removes it from the queue.',
  async (t) => {
    let grans = await granuleFactory(2, { bucket: randomId('mebucket') });
    await loadGranules(grans, t);

    grans = grans.sort(sortByFileKey);
    const expected0 = {
      granuleId: grans[0].granuleId,
      ...grans[0].files[0],
    };
    const expected1 = {
      granuleId: grans[1].granuleId,
      ...grans[1].files[0],
    };

    const bucket = grans[0].files[0].bucket;

    const sq = new ESFileSearchQueue({ bucket });

    t.deepEqual(expected0, await sq.peek());
    t.deepEqual(expected0, await sq.shift());
    t.deepEqual(expected1, await sq.peek());
    t.deepEqual(expected1, await sq.shift());
    t.deepEqual(undefined, await sq.shift());
  }
);

test.serial('esFileSearchQueue can handle paging.', async (t) => {
  const pageLengh = 3;
  process.env.ES_SCROLL_SIZE = pageLengh;
  const numGrans = 13;
  let grans = await granuleFactory(numGrans, { bucket: randomId('mebucket') });
  await loadGranules(grans, t);

  grans = grans.sort(sortByFileKey);

  const bucket = grans[0].files[0].bucket;

  const sq = new ESFileSearchQueue({ bucket });
  const spiedSq = sinon.spy(sq, 'fetchItems');

  const fetched = [];

  /* eslint-disable no-await-in-loop */
  while (await sq.peek()) {
    fetched.push(await sq.shift());
  }
  /* eslint-enable no-await-in-loop */

  t.true(spiedSq.getCalls().length >= numGrans / pageLengh);
  t.is(fetched.length, numGrans);
  delete process.env.ES_SCROLL_SIZE;
});
