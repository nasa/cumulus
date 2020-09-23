'use strict';

const test = require('ava');
const range = require('lodash/range');
const { randomId } = require('@cumulus/common/test-utils');
const { DbGranuleSearchQueues } = require('../../../lib/reconciliationReport/DbGranuleSearchQueues');

class StubGranuleSearchQueue {
  constructor(items) {
    this.items = items ? [...items] : [];
  }

  async empty() {
    const results = this.items.slice();
    this.items = [];
    return results;
  }

  peek() {
    return (this.items.length === 0) ? undefined : this.items[0];
  }

  shift() {
    return this.items.shift();
  }
}

process.env.GranulesTable = randomId('granulesTable');

test('constructor creates one queue when searchParams have no granuleIds', (t) => {
  const collectionId = 'name___version';
  const searchParams = {
    somefield: 'somevalue',
  };

  const granuleSearchQueue = new DbGranuleSearchQueues(collectionId, searchParams);
  t.is(granuleSearchQueue.queues.length, 1);
});

test('constructor creates queues for each granuleId when searchParams have multiple granuleIds', (t) => {
  const collectionId = 'name___version';
  const granuleId = range(5).map(() => randomId('granuleId'));
  const searchParams = {
    somefield: 'somevalue',
    granuleId,
  };

  const granuleSearchQueue = new DbGranuleSearchQueues(collectionId, searchParams);
  t.is(granuleSearchQueue.queues.length, granuleId.length);
});

test('peek() and shift() get and remove the next available item when there is only one queue', async (t) => {
  const collectionId = 'name___version';
  const queueItems = [randomId('queue2'), randomId('queue2'), randomId('queue2')];
  const queues = [new StubGranuleSearchQueue(queueItems)];

  const granuleSearchQueue = new DbGranuleSearchQueues(collectionId, {});
  granuleSearchQueue.queues = queues;
  let item = await granuleSearchQueue.peek();
  t.is(item, queueItems[0]);
  item = await granuleSearchQueue.shift();
  t.is(item, queueItems[0]);
  await granuleSearchQueue.shift();

  const items = await granuleSearchQueue.empty();
  t.deepEqual(items, queueItems.slice(2));
  item = await granuleSearchQueue.shift();
  t.falsy(item);
});

test('peek() and shift() get and remove the next available item from queues', async (t) => {
  const collectionId = 'name___version';
  const granuleId = range(5).map(() => randomId('granuleId'));
  const searchParams = {
    somefield: 'somevalue',
    granuleId,
  };

  const queue1Items = [randomId('queue1'), randomId('queue1')];
  const queue2Items = [randomId('queue2'), randomId('queue2'), randomId('queue2')];
  const queues = [
    new StubGranuleSearchQueue(),
    new StubGranuleSearchQueue(queue1Items.slice()),
    new StubGranuleSearchQueue(queue2Items.slice()),
    new StubGranuleSearchQueue(),
    new StubGranuleSearchQueue(),
  ];

  const granuleSearchQueue = new DbGranuleSearchQueues(collectionId, searchParams);
  granuleSearchQueue.queues = queues;
  let item = await granuleSearchQueue.peek();
  t.is(item, queue1Items[0]);
  item = await granuleSearchQueue.shift();
  t.is(item, queue1Items[0]);
  await granuleSearchQueue.shift();

  const items = await granuleSearchQueue.empty();
  t.deepEqual(items, queue2Items);
  item = await granuleSearchQueue.peek();
  t.falsy(item);
});
