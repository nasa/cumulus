'use strict';

const test = require('ava');
const providersApi = require('../providers');

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
      body: JSON.stringify(t.context.testProvider),
    },
  };
  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(providersApi.createProvider({
    prefix: t.context.testPrefix,
    provider: t.context.testProvider,
    callback,
  }));
});

test('deleteProvider calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/providers/${t.context.testProviderId}`,
    },
  };
  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(providersApi.deleteProvider({
    prefix: t.context.testPrefix,
    providerId: t.context.testProviderId,
    callback,
  }));
});

test('getProvider calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/providers/${t.context.testProviderId}`,
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(providersApi.getProvider({
    prefix: t.context.testPrefix,
    providerId: t.context.testProviderId,
    callback,
  }));
});

test('getProviders calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/providers',
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(providersApi.getProviders({
    prefix: t.context.testPrefix,
    callback,
  }));
});
