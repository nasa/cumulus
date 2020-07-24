'use strict';

const test = require('ava');
const granulesApi = require('../granules');

test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.granuleId = 'granule-1';
});

test('getGranule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/granules/${t.context.granuleId}`
    }
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.getGranule({
    callback,
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId
  }));
});

test('waitForGranules calls getGranules with the expected payload', async (t) => {
  const callback = async ({ prefix, payload }) => {
    t.true(payload.path.endsWith(t.context.granuleId));
    t.is(prefix, t.context.testPrefix);

    return { statusCode: 200 };
  };

  await granulesApi.waitForGranule({
    callback,
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId
  });
});

test('waitForGranules fails on 500 statusCode', async (t) => {
  await t.throwsAsync(granulesApi.waitForGranule({
    callback: async () => ({ statusCode: 500 }),
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId
  }));
});

test('waitForGranules retries on status codes other than 500, 200, then throws error', async (t) => {
  let retryCount = 0;
  const retries = 2;

  const callback = () => {
    retryCount += 1;
    return { statusCode: 404 };
  };

  await t.throwsAsync(granulesApi.waitForGranule({
    callback,
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    retries,
    pRetryOptions: { minTimeout: 1, maxTimeout: 1 }
  }));

  t.is(retryCount, retries + 1);
});

test('waitForGranules retries if status does not match provided status', async (t) => {
  let callbackCount = 0;

  const callback = () => {
    callbackCount += 1;

    if (callbackCount === 1) {
      return {
        statusCode: 200,
        body: '{ "status": "running" }'
      };
    }

    return {
      statusCode: 200,
      body: '{ "status": "completed" }'
    };
  };

  await granulesApi.waitForGranule({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    status: 'completed',
    pRetryOptions: { minTimeout: 1, maxTimeout: 1 },
    callback
  });

  t.is(callbackCount, 2);
});

test('reingestGranule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/granules/${t.context.granuleId}`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'reingest' })
    }
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.reingestGranule({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    callback
  }));
});

test('removeFromCmr calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/granules/${t.context.granuleId}`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'removeFromCmr' })
    }
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.removeFromCMR({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    callback
  }));
});

test('applyWorkflow calls the callback with the expected object', async (t) => {
  const workflow = 'Test Workflow';
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json'
      },
      path: `/granules/${t.context.granuleId}`,
      body: JSON.stringify({ action: 'applyWorkflow', workflow })
    }
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.applyWorkflow({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    workflow,
    callback
  }));
});

test('deleteGranule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/granules/${t.context.granuleId}`
    }
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.deleteGranule({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    callback
  }));
});

test('moveGranule calls the callback with the expected object', async (t) => {
  const destinations = 'test destination';
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json'
      },
      path: `/granules/${t.context.granuleId}`,
      body: JSON.stringify({ action: 'move', destinations })
    }
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.moveGranule({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    destinations,
    callback
  }));
});

test('listGranules calls the callback with the expected object', async (t) => {
  const query = { limit: 50 };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/granules',
      queryStringParameters: query
    }
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.listGranules({
    prefix: t.context.testPrefix,
    query,
    callback
  }));
});

test('listGranules calls the callback with the expected object if there is no query param', async (t) => {
  const query = undefined;
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/granules',
      queryStringParameters: undefined
    }
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.listGranules({
    prefix: t.context.testPrefix,
    query,
    callback
  }));
});

test('removePublishedGranule calls removeFromCmr and deleteGranule', async (t) => {
  let removeFromCmrCalled = false;
  let deleteGranuleCalled = false;

  const callback = async ({ payload }) => {
    if (
      payload.httpMethod === 'PUT'
      && payload.path === `/granules/${t.context.granuleId}`
      && payload.body.includes('removeFromCmr')
    ) {
      removeFromCmrCalled = true;
    }

    if (
      payload.httpMethod === 'DELETE'
      && payload.path === `/granules/${t.context.granuleId}`
    ) {
      deleteGranuleCalled = true;
    }
  };

  await granulesApi.removePublishedGranule({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    callback
  });

  t.true(removeFromCmrCalled);
  t.true(deleteGranuleCalled);
});
