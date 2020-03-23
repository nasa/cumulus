'use strict';

const test = require('ava');
const rewire = require('rewire');
const emsRewire = rewire('../ems');

test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.request = { body: 'request' };
  t.context.collectionVersion = 1;
});

test('createEmsReports calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json'
      },
      path: '/ems',
      body: JSON.stringify(t.context.request)
    }
  };

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };
  let revertCallback;
  try {
    revertCallback = emsRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(emsRewire.createEmsReports({
      prefix: t.context.testPrefix,
      request: t.context.request
    }));
  } finally {
    revertCallback();
  }
});

test.serial('getLambdaEmsSettings returns the expected environment variables', async (t) => {
  let emsRevert;
  try {
    emsRevert = emsRewire.__set__('lambda', () => ({
      getFunctionConfiguration: () => ({
        promise: async () => ({
          Environment: {
            Variables: {
              ems_var1: 'value 1',
              ems_var2: 'value 2',
              env_var: 'not ems'
            }
          }
        })
      })
    }));

    const expected = {
      var1: 'value 1',
      var2: 'value 2'
    };

    const actual = await emsRewire.getLambdaEmsSettings('mockLambdaName');
    t.deepEqual(expected, actual);
  } finally {
    emsRevert();
  }
});
