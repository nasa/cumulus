'use strict';

const test = require('ava');
const pdrsApi = require('../pdrs');

test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.name = 'testPdr';
  t.context.testPdrReturn = { body: '{"some": "object"}' };
});

test('getPdr calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/pdr/${t.context.name}`,
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
    return (t.context.testPdrReturn);
  };

  await t.notThrowsAsync(pdrsApi.getPdr({
    prefix: t.context.testPrefix,
    pdrName: t.context.name,
    callback,
  }));
});

test('getPdrs calls the callback with the expected object', async (t) => {
  const query = { limit: 50 };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/pdrs',
      queryStringParameters: query,
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(pdrsApi.getPdrs({
    prefix: t.context.testPrefix,
    query,
    callback,
  }));
});