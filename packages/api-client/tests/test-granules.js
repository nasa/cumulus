'use strict';

const test = require('ava');
const { randomId } = require('../../common/test-utils');
const granulesApi = require('../granules');

test.before((t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.granuleId = randomId('gran/a-b-c-123');
  t.context.collectionId = `fakeName___${randomId('col/e-f-g-456')}`;
  t.context.collectionId2 = `fakeName2___${randomId('col/e-f-g-456')}`;
  t.context.status = 'queued';
});

test('getGranule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/granules/${encodeURIComponent(t.context.granuleId)}`,
    },
    expectedStatusCodes: undefined,
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
    return Promise.resolve({
      body: JSON.stringify({
        granuleId: t.context.granuleId,
      }),
    });
  };

  await t.notThrowsAsync(granulesApi.getGranule({
    callback,
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
  }));
});

test('getGranule calls the callback with the expected status codes', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/granules/${encodeURIComponent(t.context.granuleId)}`,
    },
    expectedStatusCodes: [404, 200],
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
    return Promise.resolve({
      body: JSON.stringify({
        granuleId: t.context.granuleId,
        expectedStatusCodes: [404, 200],
      }),
    });
  };

  await t.notThrowsAsync(granulesApi.getGranule({
    callback,
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    expectedStatusCodes: [404, 200],
  }));
});

test('getGranule calls the callback with the expected object when there is query param', async (t) => {
  const query = { getRecoveryStatus: true };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      queryStringParameters: query,
      path: `/granules/${encodeURIComponent(t.context.collectionId)}/${encodeURIComponent(t.context.granuleId)}`,
    },
    expectedStatusCodes: undefined,
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
    return Promise.resolve({
      body: JSON.stringify({
        granuleId: t.context.granuleId,
        collectionId: t.context.collectionId,
      }),
    });
  };

  await t.notThrowsAsync(granulesApi.getGranule({
    callback,
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    collectionId: t.context.collectionId,
    query,
  }));
});

test('getGranule accepts an optional collectionId', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    expectedStatusCodes: [404, 200],
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/granules/${encodeURIComponent(t.context.collectionId)}/${encodeURIComponent(t.context.granuleId)}`,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
    return Promise.resolve({
      body: JSON.stringify({
        granuleId: t.context.granuleId,
        collectionId: t.context.collectionId,
      }),
    });
  };

  await t.notThrowsAsync(granulesApi.getGranule({
    callback,
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    collectionId: t.context.collectionId,
    expectedStatusCodes: [404, 200],
  }));
});

test('waitForGranules calls getGranules with the expected payload', async (t) => {
  const callback = ({ prefix, payload }) => {
    t.true(payload.path.endsWith(encodeURIComponent(t.context.granuleId)));
    t.is(prefix, t.context.testPrefix);

    return Promise.resolve({ statusCode: 200 });
  };

  await granulesApi.waitForGranule({
    callback,
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
  });
});

test('waitForGranules fails on 500 statusCode', async (t) => {
  await t.throwsAsync(granulesApi.waitForGranule({
    callback: () => Promise.resolve({ statusCode: 500 }),
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
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
    pRetryOptions: { minTimeout: 1, maxTimeout: 1 },
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
        body: '{ "status": "running" }',
      };
    }

    return {
      statusCode: 200,
      body: '{ "status": "completed" }',
    };
  };

  await granulesApi.waitForGranule({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    status: 'completed',
    pRetryOptions: { minTimeout: 1, maxTimeout: 1 },
    callback,
  });

  t.is(callbackCount, 2);
});

test('reingestGranule calls the callback with the expected object', async (t) => {
  const aWorkflow = 'anyWorkflowName';
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      path: `/granules/${encodeURIComponent(t.context.granuleId)}`,
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      body: JSON.stringify({
        action: 'reingest',
        workflowName: aWorkflow,
      }),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.reingestGranule({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    workflowName: aWorkflow,
    callback,
  }));
});

test('removeFromCmr calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      path: `/granules/${encodeURIComponent(t.context.granuleId)}`,
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      body: JSON.stringify({
        action: 'removeFromCmr',
      }),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.removeFromCMR({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    callback,
  }));
});

test('applyWorkflow calls the callback with the expected object', async (t) => {
  const workflow = 'Test Workflow';
  const meta = { test: 'Test Meta Value' };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      path: `/granules/${encodeURIComponent(t.context.granuleId)}`,
      body: JSON.stringify({ action: 'applyWorkflow', workflow, meta }),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.applyWorkflow({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    workflow,
    meta,
    callback,
  }));
});

test('deleteGranule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    pRetryOptions: { foo: 'bar' },
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/granules/${encodeURIComponent(t.context.granuleId)}`,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.deleteGranule({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    pRetryOptions: { foo: 'bar' },
    callback,
  }));
});

test('moveGranule calls the callback with the expected object', async (t) => {
  const destinations = 'test destination';
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      path: `/granules/${encodeURIComponent(t.context.granuleId)}`,
      body: JSON.stringify({ action: 'move', destinations }),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.moveGranule({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    destinations,
    callback,
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
      queryStringParameters: query,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.listGranules({
    prefix: t.context.testPrefix,
    query,
    callback,
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
      queryStringParameters: undefined,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.listGranules({
    prefix: t.context.testPrefix,
    query,
    callback,
  }));
});

test('removePublishedGranule calls removeFromCmr and deleteGranule', async (t) => {
  let removeFromCmrCalled = false;
  let deleteGranuleCalled = false;

  const callback = ({ payload }) => {
    if (
      payload.httpMethod === 'PATCH'
      && payload.path === `/granules/${encodeURIComponent(t.context.granuleId)}`
      && payload.body.includes('removeFromCmr')
    ) {
      removeFromCmrCalled = true;
    }

    if (
      payload.httpMethod === 'DELETE'
      && payload.path === `/granules/${encodeURIComponent(t.context.granuleId)}`
    ) {
      deleteGranuleCalled = true;
    }
  };

  await granulesApi.removePublishedGranule({
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    callback,
  });

  t.true(removeFromCmrCalled);
  t.true(deleteGranuleCalled);
});

test('createGranule calls the callback with the expected object', async (t) => {
  const body = { any: 'object' };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      path: '/granules',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.createGranule({
    callback,
    prefix: t.context.testPrefix,
    body,
  }));
});

test('replaceGranule calls the callback with the expected object', async (t) => {
  const body = {
    granuleId: t.context.granuleId,
    collectionId: t.context.collectionId,
    any: 'object',
    status: t.context.status,
  };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/granules/${encodeURIComponent(t.context.collectionId)}/${encodeURIComponent(t.context.granuleId)}`,
      headers: { 'Content-Type': 'application/json', 'Cumulus-API-Version': '2' },
      body: JSON.stringify(body),
    },
    expectedStatusCodes: [200, 201],
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.replaceGranule({
    callback,
    prefix: t.context.testPrefix,
    body,
  }));
});

test('updateGranule calls the callback with the expected object', async (t) => {
  const body = {
    granuleId: t.context.granuleId,
    any: 'object',
    status: t.context.status,
  };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      path: `/granules/${encodeURIComponent(t.context.collectionId)}/${encodeURIComponent(t.context.granuleId)}`,
      headers: { 'Content-Type': 'application/json', 'Cumulus-API-Version': '2' },
      body: JSON.stringify(body),
    },
    expectedStatusCodes: [200, 201],
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.updateGranule({
    callback,
    prefix: t.context.testPrefix,
    granuleId: t.context.granuleId,
    collectionId: t.context.collectionId,
    body,
  }));
});

test('associateExecutionWithGranule calls the callback with the expected object', async (t) => {
  const body = {
    granuleId: t.context.granuleId,
    collectionId: randomId('collectionId'),
    executionArn: randomId('executionArn'),
  };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      path: `/granules/${encodeURIComponent(t.context.granuleId)}/executions`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(granulesApi.associateExecutionWithGranule({
    callback,
    prefix: t.context.testPrefix,
    body,
  }));
});

test('bulkOperation calls the callback with the expected object', async (t) => {
  const workflowName = randomId('workflowName');
  const granuleId = t.context.granuleId;
  const granules = [granuleId];

  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      path: '/granules/bulk/',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        granules,
        workflowName,
      }),
    },
    expectedStatusCodes: 202,
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(
    granulesApi.bulkOperation({
      callback,
      prefix: t.context.testPrefix,
      granules,
      workflowName,
    })
  );
});

test('bulkPatchGranuleCollection calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/granules/bulkPatchGranuleCollection',
      body: JSON.stringify({
        apiGranules: [{
          granule_id: t.context.granuleId,
          collectionId: t.context.collectionId,
        }],
        collectionId: t.context.collectionId2,
      }),
    },
    expectedStatusCodes: 200,
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
    return Promise.resolve({
      body: JSON.stringify({
        apiGranules: [{
          granule_id: t.context.granuleId,
          collectionId: t.context.collectionId,
        }],
        collectionId: t.context.collectionId2,
      }),
    });
  };

  await t.notThrowsAsync(granulesApi.bulkPatchGranuleCollection({
    callback,
    prefix: t.context.testPrefix,
    body: {
      apiGranules: [{
        granule_id: t.context.granuleId,
        collectionId: t.context.collectionId,
      }],
      collectionId: t.context.collectionId2,
    },
  }));
});

test('bulkPatch calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/granules/bulkPatch',
      body: JSON.stringify({
        apiGranules: [{
          granule_id: t.context.granuleId,
          collectionId: t.context.collectionId2,
        }],
        dbConcurrency: 5,
        dbMaxPool: 10,
      }),
    },
    expectedStatusCodes: 200,
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
    return Promise.resolve({
      body: JSON.stringify({
        apiGranules: [{
          granule_id: t.context.granuleId,
          collectionId: t.context.collectionId2,
        }],
        dbConcurrency: 5,
        dbMaxPool: 10,
      }),
    });
  };

  await t.notThrowsAsync(granulesApi.bulkPatch({
    callback,
    prefix: t.context.testPrefix,
    body: {
      apiGranules: [{
        granule_id: t.context.granuleId,
        collectionId: t.context.collectionId2,
      }],
      dbConcurrency: 5,
      dbMaxPool: 10,
    },
  }));
});

test('bulkChangeCollection calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/granules/bulkChangeCollection/',
      body: JSON.stringify({
        sourceCollectionId: t.context.collectionId,
        targetCollectionId: t.context.collectionId2,
      }),
    },
    expectedStatusCodes: 200,
  };
  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };
  await t.notThrowsAsync(granulesApi.bulkChangeCollection({
    callback,
    prefix: t.context.testPrefix,
    body: {
      sourceCollectionId: t.context.collectionId,
      targetCollectionId: t.context.collectionId2,
    },
  }));
});

test('getFileGranuleAndCollectionByBucketAndKey calls the callback with the expected object', async (t) => {
  const bucket = randomId('my-test-bucket');
  const key = randomId('path/to/my/file.txt');
  const pRetryOptions = { foo: 'bar' };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/granules/files/get_collection_and_granule_id/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
    },
    pRetryOptions,
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
    return Promise.resolve({
      body: JSON.stringify({
        bucket,
        key,
      }),
    });
  };

  await t.notThrowsAsync(granulesApi.getFileGranuleAndCollectionByBucketAndKey({
    callback,
    prefix: t.context.testPrefix,
    bucket,
    key,
    pRetryOptions,
  }));
});

test('bulkArchiveGranules calls the callback with the expected object and returns the parsed response', async (t) => {
  const body = {
    batchSize: 100,
    expirationDays: 200,
  };

  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/granules/bulkArchive/',
      body: JSON.stringify(body),
    },
    expectedStatusCodes: 202,
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(granulesApi.bulkArchiveGranules({
    prefix: t.context.testPrefix,
    body,
    callback,
  }));
});
