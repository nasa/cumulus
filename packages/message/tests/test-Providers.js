'use strict';

const test = require('ava');

const {
  getMessageProviderId,
} = require('../Providers');

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
    cumulus_meta: {},
  });
  t.is(providerId, undefined);
});
