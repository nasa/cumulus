'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');

const fakeServices = {};

const apiClient = proxyquire(
  '../cumulusApiClient',
  {
    '@cumulus/aws-client/services': fakeServices,
  }
);

test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.testPayload = { payload: 'payloadValue' };
  // eslint-disable-next-line quotes
  t.context.testLambdaReturn = { statusCode: 200, body: `{"Key": false}` };
});

test.serial('invokeApi invokes the lambda with the expected Payload and FunctionName', async (t) => {
  const Payload = {
    FunctionName: `${t.context.testPrefix}-PrivateApiLambda`,
    Payload: JSON.stringify(t.context.testPayload),
  };

  fakeServices.lambda = () => ({
    invoke: (payloadObject) => {
      const passedPayload = payloadObject;
      return {
        promise: async () => {
          t.deepEqual(Payload, passedPayload);
          return { Payload: JSON.stringify(t.context.testLambdaReturn) };
        },
      };
    },
  });

  const expected = { statusCode: 200, body: '{"Key": false}' };

  const actual = await apiClient.invokeApi({
    prefix: t.context.testPrefix,
    payload: t.context.testPayload,
  });
  t.deepEqual(expected, actual);
});

test.serial('invokeApi retries on timeout failure, then throws error on failure', async (t) => {
  let lambdaInvocations = 0;

  fakeServices.lambda = () => ({
    invoke: () => {
      lambdaInvocations += 1;
      return {
        promise: async () => ({ Payload: JSON.stringify({ errorMessage: 'Task timed out' }) }),
      };
    },
  });

  await t.throwsAsync(apiClient.invokeApi({
    prefix: t.context.testPrefix,
    payload: t.context.testPayload,
    pRetryOptions: {
      minTimeout: 1,
      maxTimeout: 1,
    },
  }));

  t.is(4, lambdaInvocations);
});
