'use strict';

const test = require('ava');
const rewire = require('rewire');
const rewireApiClient = rewire('../cumulusApiClient');

test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.testPayload = { payload: 'payloadValue' };
});

test.serial('invokeApi invokes the lambda with the expected Payload and FunctionName', async (t) => {
  let revertApiClient;
  try {
    const expected = {
      FunctionName: `${t.context.testPrefix}-PrivateApiLambda`,
      Payload: JSON.stringify(t.context.testPayload)
    };
    revertApiClient = rewireApiClient.__set__('lambda', () => ({
      invoke: (payloadObject) => {
        const passedPayload = payloadObject;
        return {
          promise: async () => {
            t.deepEqual(expected, passedPayload);
            return { Payload: JSON.stringify(t.context.testPayload) };
          }
        };
      }
    }));
    await t.notThrowsAsync(rewireApiClient.invokeApi({
      prefix: t.context.testPrefix,
      payload: t.context.testPayload
    }));
  } finally {
    revertApiClient();
  }
});

test.serial('invokeApi retries on timeout failure, then throws error on failure', async (t) => {
  let revertApiClient;
  let lambdaInvocations = 0;
  try {
    revertApiClient = rewireApiClient.__set__('lambda', () => ({
      invoke: () => {
        lambdaInvocations += 1;
        return {
          promise: async () => ({ Payload: JSON.stringify({ errorMessage: 'Task timed out' }) })
        };
      }
    }));
    await t.throwsAsync(rewireApiClient.invokeApi({
      prefix: t.context.testPrefix,
      payload: t.context.testPayload
    }));
    t.is(4, lambdaInvocations);
  } finally {
    revertApiClient();
  }
});
