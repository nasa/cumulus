'use strict';

const test = require('ava');
const rewire = require('rewire');
const granulesRewire = rewire('../granules');

test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.granule = 'granule-1';
});

test('getGranule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/granules/${t.context.granule}`
    }
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  let revertCallback;
  try {
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(granulesRewire.getGranule({
      prefix: t.context.testPrefix,
      granuleId: t.context.granule
    }));
  } finally {
    revertCallback();
  }
});


test.serial('waitForGranules calls getGranules with the expected payload', async (t) => {
  const granule = t.context.granule;
  const getGranuleRevert = granulesRewire.__set__('getGranule', async ({ prefix, granuleId, callback }) => {
    t.is(granule, granuleId);
    t.is(t.context.testPrefix, prefix);
    return callback();
  });
  let revertCallback;
  try {
    const callback = () => ({ statusCode: 200 });
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await granulesRewire.waitForGranule({
      prefix: t.context.testPrefix,
      granuleId: t.context.granule
    });
  } finally {
    getGranuleRevert();
    revertCallback();
  }
});


test.serial('waitForGranules fails on 500 statusCode', async (t) => {
  const getGranuleRevert = granulesRewire.__set__('getGranule', async ({ callback }) => callback());
  let revertCallback;
  try {
    const callback = () => ({ statusCode: 500 });
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await t.throwsAsync(granulesRewire.waitForGranule({
      prefix: t.context.testPrefix,
      granuleId: t.context.granule,
      callback
    }));
  } finally {
    getGranuleRevert();
    revertCallback();
  }
});

test.serial('waitForGranules retries on status codes other than 500, 200, then throws error', async (t) => {
  let retryCount = 0;
  const retries = 2;
  const getGranuleRevert = granulesRewire.__set__('getGranule', async ({ callback }) => {
    retryCount += 1;
    return callback();
  });
  let revertCallback;
  try {
    const callback = () => ({ statusCode: 404 });
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await t.throwsAsync(granulesRewire.waitForGranule({
      prefix: t.context.testPrefix,
      granuleId: t.context.granule,
      retries,
      callback
    }));
    t.is(retries + 1, retryCount);
  } finally {
    getGranuleRevert();
    revertCallback();
  }
});


test('reingestGranule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/granules/${t.context.granule}`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'reingest' })
    }
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  let revertCallback;
  try {
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(granulesRewire.reingestGranule({
      prefix: t.context.testPrefix,
      granuleId: t.context.granule
    }));
  } finally {
    revertCallback();
  }
});

test('removeFromCmr calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/granules/${t.context.granule}`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'removeFromCmr' })
    }
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  let revertCallback;
  try {
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(granulesRewire.removeFromCMR({
      prefix: t.context.testPrefix,
      granuleId: t.context.granule
    }));
  } finally {
    revertCallback();
  }
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
      path: `/granules/${t.context.granule}`,
      body: JSON.stringify({ action: 'applyWorkflow', workflow })
    }
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  let revertCallback;
  try {
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(granulesRewire.applyWorkflow({
      prefix: t.context.testPrefix,
      granuleId: t.context.granule,
      workflow
    }));
  } finally {
    revertCallback();
  }
});

test('deleteGranule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/granules/${t.context.granule}`
    }
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  let revertCallback;
  try {
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(granulesRewire.deleteGranule({
      prefix: t.context.testPrefix,
      granuleId: t.context.granule
    }));
  } finally {
    revertCallback();
  }
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
      path: `/granules/${t.context.granule}`,
      body: JSON.stringify({ action: 'move', destinations })
    }
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  let revertCallback;
  try {
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(granulesRewire.moveGranule({
      prefix: t.context.testPrefix,
      granuleId: t.context.granule,
      destinations
    }));
  } finally {
    revertCallback();
  }
});

test('listGranules calls the callback with the expected object', async (t) => {
  const query = 'testQuery';
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/granules',
      body: query ? JSON.stringify({ query }) : undefined
    }
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  let revertCallback;
  try {
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(granulesRewire.listGranules({
      prefix: t.context.testPrefix,
      query
    }));
  } finally {
    revertCallback();
  }
});


test('listGranules calls the callback with the expected object if there is no query param', async (t) => {
  const query = undefined;
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/granules',
      body: query ? JSON.stringify({ query }) : undefined
    }
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  let revertCallback;
  try {
    revertCallback = granulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(granulesRewire.listGranules({
      prefix: t.context.testPrefix,
      query
    }));
  } finally {
    revertCallback();
  }
});

test.serial('removePublishedGranule calls removeFromCmr and deleteGranule', async (t) => {
  let removeFromCmrRevert;
  let deleteGranuleRevert;
  let callbackRevert;
  try {
    const mockCallback = () => true;
    callbackRevert = granulesRewire.__set__('invokeApi', mockCallback);

    removeFromCmrRevert = granulesRewire.__set__('removeFromCMR',
      async ({ prefix, granuleId, callback }) => {
        t.is(t.context.testPrefix, prefix);
        t.is(t.context.granule, granuleId);
        t.is(callback, mockCallback);
      });

    deleteGranuleRevert = granulesRewire.__set__('deleteGranule',
      async ({ prefix, granuleId, callback }) => {
        t.is(t.context.testPrefix, prefix);
        t.is(t.context.granule, granuleId);
        t.is(callback, mockCallback);
      });

    await granulesRewire.removePublishedGranule({
      prefix: t.context.testPrefix,
      granuleId: t.context.granule
    });
  } finally {
    removeFromCmrRevert();
    deleteGranuleRevert();
    callbackRevert();
  }
});
