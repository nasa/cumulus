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

test.before((t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.testPayload = { payload: 'payloadValue' };
  // eslint-disable-next-line quotes
  t.context.testLambdaReturn = { statusCode: 200, body: `{"Key": false}` };
});

test.serial('invokeApi invokes the lambda with the expected Payload and FunctionName', async (t) => {
  const Payload = {
    FunctionName: `${t.context.testPrefix}-PrivateApiLambda`,
    Payload: new TextEncoder().encode(JSON.stringify(t.context.testPayload)),
  };

  fakeServices.lambda = () => ({
    invoke: (payloadObject) => {
      const passedPayload = payloadObject;
      t.deepEqual(Payload, passedPayload);
      return Promise.resolve({
        Payload: new TextEncoder().encode(JSON.stringify(t.context.testLambdaReturn)),
      });
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
      return Promise.resolve({
        Payload: new TextEncoder().encode(JSON.stringify({ errorMessage: 'Task timed out' })),
      });
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

test.serial('invokeApi retries on status code failure, then throws expected error on failure', async (t) => {
  let lambdaInvocations = 0;

  fakeServices.lambda = () => ({
    invoke: () => {
      lambdaInvocations += 1;
      return Promise.resolve({
        Payload: new TextEncoder().encode(JSON.stringify({
          statusCode: 500,
          body: JSON.stringify({
            message: 'API failure',
          }),
        })),
      });
    },
  });

  const actualError = await t.throwsAsync(apiClient.invokeApi({
    prefix: t.context.testPrefix,
    payload: t.context.testPayload,
    pRetryOptions: {
      retries: 4,
      minTimeout: 1,
      maxTimeout: 1,
    },
  }));

  t.is(5, lambdaInvocations);
  t.is(actualError.statusCode, 500);
  t.is(actualError.apiMessage, '{"message":"API failure"}');
});

test.serial('invokeApi respects expected non-200 status code', async (t) => {
  let lambdaInvocations = 0;

  fakeServices.lambda = () => ({
    invoke: () => {
      lambdaInvocations += 1;
      return Promise.resolve({
        Payload: new TextEncoder().encode(JSON.stringify({
          statusCode: 202,
          body: JSON.stringify({
            message: 'success',
          }),
        })),
      });
    },
  });

  await t.notThrowsAsync(apiClient.invokeApi({
    prefix: t.context.testPrefix,
    payload: t.context.testPayload,
    pRetryOptions: {
      minTimeout: 1,
      maxTimeout: 1,
    },
    expectedStatusCodes: 202,
  }));

  t.is(1, lambdaInvocations);
});

test.serial('invokeApi respects multiple accepted status codes', async (t) => {
  let lambdaInvocations = 0;

  fakeServices.lambda = () => ({
    invoke: () => {
      lambdaInvocations += 1;
      return Promise.resolve({
        Payload: new TextEncoder().encode(JSON.stringify({
          statusCode: lambdaInvocations === 1 ? 201 : 200,
          body: JSON.stringify({
            message: 'success',
          }),
        })),
      });
    },
  });

  const response1 = await apiClient.invokeApi({
    prefix: t.context.testPrefix,
    payload: t.context.testPayload,
    pRetryOptions: {
      minTimeout: 1,
      maxTimeout: 1,
    },
    expectedStatusCodes: [200, 201],
  });
  t.is(response1.statusCode, 201);

  const response2 = await apiClient.invokeApi({
    prefix: t.context.testPrefix,
    payload: t.context.testPayload,
    pRetryOptions: {
      minTimeout: 1,
      maxTimeout: 1,
    },
    expectedStatusCodes: [200, 201],
  });
  t.is(response2.statusCode, 200);

  t.is(2, lambdaInvocations);
});
