'use strict';

const test = require('ava');

const {
  getMessageProvider,
  getMessageProviderId,
  isMessageWithProvider,
  isMessageProvider
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
test.only('isMessageProvider correctly filters for messageProviders', (t) => {
  t.false(isMessageProvider('a')); // must be obj
  t.false(isMessageProvider(3)); // must be obj
  t.true(isMessageProvider({ id: 'a', protocol: 'b', host: 'c' }));
  t.true(isMessageProvider({ id: 'a', protocol: 'b', host: 'c', port: 3 }));
  t.false(isMessageProvider({ id: 'a', protocol: 'b', host: 'c', port: 'a' })); // port must be number
  // obj must contain id, protocol, and host as strings
  t.false(isMessageProvider({}));
  t.false(isMessageProvider({ id: 'a', protocol: 'b', host: 3 }));
  t.false(isMessageProvider({ id: 'a', protocol: 3, host: 'a' }));
  t.false(isMessageProvider({ id: 5, protocol: 'c', host: 'a' }));
});
test('isMessageWithProvider correctly filters for messgaeWithProvider', (t) => {
  /* this calls isCumulusMessageLike and isMessageProvider and inherits their behavior and tests */
  t.true(isMessageWithProvider({ cumulus_meta: {}, meta: { provider: { id: 'a', protocol: 'b', host: 'c', port: 3 } } }));
  t.false(isMessageWithProvider({ cumulus_meta: {} })); // must have a meta attribute
  t.false(isMessageWithProvider({ cumulus_meta: {}, meta: {} })); // must have a provider
  t.false(isMessageWithProvider({
    cumulus_meta: {},
    meta: { provider: {} },
  })); // provider must be a provider
});
