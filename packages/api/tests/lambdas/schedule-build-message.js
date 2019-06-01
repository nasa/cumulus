'use strict'

const test = require('ava');
const rewire = require('rewire');

const schedule = rewire('../../lambdas/sf-scheduler');

const eventTemplate = {
  cumulusMeta: {},
  payload: {},
  template: 's3://somewhwere/nice'
};
const fakeMessageTemplate = {
  meta: {
    queues: {
      startSF: 'startSF'
    }
  }
};
const fakeCollection = {
  name: 'fakeCollection',
  version: '000'
};
const fakeProvider = {
  id: 'fakeProviderId',
  host: 'fakeHost'
};

const buildMessage = schedule.__get__('buildMessage');

test.serial('event has valid collection and provider', async (t) => {
  const restoreGetCollection = schedule.__set__('getCollection', () => Promise.resolve(fakeCollection));
  const restoreGetProvider = schedule.__set__('getProvider', () => Promise.resolve(fakeProvider));

  const buildMessageEventInput = {
    ...eventTemplate,
    provider: 'fakeProvider',
    collection: 'fakeCollection'
  }

  const response = await buildMessage(buildMessageEventInput, fakeMessageTemplate);

  t.deepEqual(response.meta.collection, fakeCollection);
  t.deepEqual(response.meta.provider, fakeProvider);

  restoreGetCollection();
  restoreGetProvider();
});

test.serial('event.meta is not overwritten by invalid event.collection|provider', async (t) => {
  const restoreGetCollection = schedule.__set__('getCollection', () => Promise.resolve(undefined));
  const restoreGetProvider = schedule.__set__('getProvider', () => Promise.resolve(undefined));

  const buildMessageEventInput = {
    ...eventTemplate,
    meta: {
      collection: fakeCollection,
      provider: fakeProvider
    }
  }

  const response = await buildMessage(buildMessageEventInput, fakeMessageTemplate);

  t.deepEqual(response.meta.collection, fakeCollection);
  t.deepEqual(response.meta.provider, fakeProvider);

  restoreGetCollection();
  restoreGetProvider();
});