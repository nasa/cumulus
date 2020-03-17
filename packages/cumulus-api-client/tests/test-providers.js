'use strict';

const test = require('ava');
const rewire = require('rewire');
const providerRewire = rewire('../providers');


test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.testProviderId = 'testProviderId';
  t.context.testProvider = '{ some: "providerObject" }';
});


test('createProvider calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path: '/providers',
      body: JSON.stringify(t.context.testProvider)
    }
  };
  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  let revertCallback;
  try {
    revertCallback = providerRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(providerRewire.createProvider({
      prefix: t.context.testPrefix,
      provider: t.context.testProvider,
    }));
  } finally {
    revertCallback();
  }
});


test('deleteProvider calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/providers/${t.context.testProviderId}`
    }
  };
  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  let revertCallback;
  try {
    revertCallback = providerRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(providerRewire.deleteProvider({
      prefix: t.context.testPrefix,
      providerId: t.context.testProviderId,
    }));
  } finally {
    revertCallback();
  }
});

test('getProvider calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/providers/${t.context.testProviderId}`
    }
  };
  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  let revertCallback;
  try {
    revertCallback = providerRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(providerRewire.getProvider({
      prefix: t.context.testPrefix,
      providerId: t.context.testProviderId,
    }));
  } finally {
    revertCallback();
  }
});
