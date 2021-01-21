'use strict';

const test = require('ava');

const {
  getMessageProvider,
  getMessageProviderId,
} = require('../Providers');

test('getMessageProvider returns correct provider', (t) => {
  const provider = {
    id: 'provider1',
    protocol: 's3',
    host: 'random-bucket',
  };
  const messageProvider = getMessageProvider({
    meta: {
      provider,
    },
  });
  t.deepEqual(messageProvider, provider);
});

test('getMessageProvider returns undefined if there is no provider in the message', (t) => {
  const messageProvider = getMessageProvider({
    meta: {},
  });
  t.is(messageProvider, undefined);
});

test('getMessageProviderId returns correct provider ID', (t) => {
  const providerId = getMessageProviderId({
    meta: {
      provider: {
        id: 'fake-provider-id',
      },
    },
  });
  t.is(providerId, 'fake-provider-id');
});

test('getMessageProviderId returns undefined if there is no provider ID', (t) => {
  const providerId = getMessageProviderId({
    meta: {},
  });
  t.is(providerId, undefined);
});
