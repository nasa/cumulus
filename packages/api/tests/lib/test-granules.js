const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const { randomId } = require('@cumulus/common/test-utils');

const {
  getExecutionProcessingTimeInfo,
  getGranuleProductVolume,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  moveGranuleFilesAndUpdateDatastore,
} = require('../../lib/granules');

const sandbox = sinon.createSandbox();
const FakeEsClient = sandbox.stub();
const esSearchStub = sandbox.stub();
const esScrollStub = sandbox.stub();
FakeEsClient.prototype.scroll = esScrollStub;
FakeEsClient.prototype.search = esSearchStub;
class FakeSearch {
  static es() {
    return new FakeEsClient();
  }
}

const { getGranulesForPayload, getGranuleIdsForPayload } = proxyquire('../../lib/granules', {
  '@cumulus/es-client/search': {
    Search: FakeSearch,
  },
});

test.afterEach.always(() => {
  sandbox.resetHistory();
});

test.after.always(() => {
  sandbox.restore();
});

test('getExecutionProcessingTimeInfo() returns empty object if startDate is not provided', (t) => {
  t.deepEqual(
    getExecutionProcessingTimeInfo({}),
    {}
  );
});

test('getExecutionProcessingTimeInfo() returns correct object if stopDate is provided', (t) => {
  const startDate = new Date();
  const stopDate = new Date();
  t.deepEqual(
    getExecutionProcessingTimeInfo({
      startDate,
      stopDate,
    }),
    {
      processingStartDateTime: startDate.toISOString(),
      processingEndDateTime: stopDate.toISOString(),
    }
  );
});

test('getExecutionProcessingTimeInfo() returns correct object if stopDate is not provided', (t) => {
  const startDate = new Date();
  const now = new Date();
  t.deepEqual(
    getExecutionProcessingTimeInfo({
      startDate,
      now,
    }),
    {
      processingStartDateTime: startDate.toISOString(),
      processingEndDateTime: now.toISOString(),
    }
  );
});

test('getGranuleTimeToArchive() returns 0 if post_to_cmr_duration is missing from granule', (t) => {
  t.is(getGranuleTimeToArchive(), 0);
});

test('getGranuleTimeToArchive() returns correct duration', (t) => {
  const postToCmrDuration = 5000;
  t.is(
    getGranuleTimeToArchive({
      post_to_cmr_duration: postToCmrDuration,
    }),
    5
  );
});

test('getGranuleTimeToPreprocess() returns 0 if sync_granule_duration is missing from granule', (t) => {
  t.is(getGranuleTimeToPreprocess(), 0);
});

test('getGranuleTimeToPreprocess() returns correct duration', (t) => {
  const syncGranuleDuration = 3000;
  t.is(
    getGranuleTimeToPreprocess({
      sync_granule_duration: syncGranuleDuration,
    }),
    3
  );
});

test('getGranuleProductVolume() returns correct product volume', (t) => {
  t.is(
    getGranuleProductVolume([{
      size: 1,
    }, {
      size: 2,
    }]),
    3
  );

  t.is(
    getGranuleProductVolume([{
      foo: '1',
    }, {
      size: 'not-a-number',
    }]),
    0
  );
});

test('moveGranuleFilesAndUpdateDatastore throws if granulePgModel.getRecordCumulusId throws unexpected error', async (t) => {
  const updateStub = sinon.stub().returns(Promise.resolve());
  const granulesModel = {
    update: updateStub,
  };

  const granulePgModel = {
    getRecordCumulusId: () => {
      const thrownError = new Error('Test error');
      thrownError.name = 'TestError';
      return Promise.reject(thrownError);
    },
  };

  const collectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(1),
  };

  const apiGranule = { granuleId: 'fakeGranule', collectionId: 'fakeCollection___001' };
  await t.throwsAsync(moveGranuleFilesAndUpdateDatastore({
    apiGranule,
    granulesModel,
    destinations: undefined,
    granulePgModel,
    collectionPgModel,
    dbClient: {},
  }));
});

test('getGranuleIdsForPayload returns unique granule IDs from payload', async (t) => {
  const granuleId1 = randomId('granule');
  const granuleId2 = randomId('granule');
  const ids = [granuleId1, granuleId1, granuleId2];
  const returnedIds = await getGranuleIdsForPayload({
    ids,
  });
  t.deepEqual(
    returnedIds.sort(),
    [granuleId1, granuleId2].sort()
  );
});

test.serial('getGranuleIdsForPayload returns unique granule IDs from query', async (t) => {
  const granuleId1 = randomId('granule');
  const granuleId2 = randomId('granule');
  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granuleId1,
          },
        }, {
          _source: {
            granuleId: granuleId1,
          },
        }, {
          _source: {
            granuleId: granuleId2,
          },
        }],
        total: {
          value: 3,
        },
      },
    },
  });
  const returnedIds = await getGranuleIdsForPayload({
    query: 'fake-query',
    index: 'fake-index',
  });
  t.deepEqual(
    returnedIds.sort(),
    [granuleId1, granuleId2].sort()
  );
});

test.serial('getGranuleIdsForPayload handles query paging', async (t) => {
  const granuleId1 = randomId('granule');
  const granuleId2 = randomId('granule');
  const granuleId3 = randomId('granule');
  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granuleId1,
          },
        }, {
          _source: {
            granuleId: granuleId2,
          },
        }],
        total: {
          value: 3,
        },
      },
    },
  });
  esScrollStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granuleId3,
          },
        }],
        total: {
          value: 3,
        },
      },
    },
  });
  t.deepEqual(
    await getGranuleIdsForPayload({
      query: 'fake-query',
      index: 'fake-index',
    }),
    [granuleId1, granuleId2, granuleId3]
  );
});

test('getGranulesForPayload returns unique granules from payload', async (t) => {
  const granuleId1 = randomId('granule');
  const granuleId2 = randomId('granule');
  const collectionId1 = randomId('collection');
  const collectionId2 = randomId('collection');
  const granules = [
    { granuleId: granuleId1, collectionId: collectionId1 },
    { granuleId: granuleId1, collectionId: collectionId1 },
    { granuleId: granuleId1, collectionId: collectionId2 },
    { granuleId: granuleId2, collectionId: collectionId2 },
  ];
  const returnedGranules = await getGranulesForPayload({
    granules,
  });
  t.deepEqual(
    returnedGranules.sort(),
    [{ granuleId: granuleId1, collectionId: collectionId1 },
      { granuleId: granuleId1, collectionId: collectionId2 },
      { granuleId: granuleId2, collectionId: collectionId2 }].sort()
  );
});

test.serial('getGranulesForPayload returns unique granules from query', async (t) => {
  const granuleId1 = randomId('granule');
  const granuleId2 = randomId('granule');
  const collectionId1 = randomId('collection');
  const collectionId2 = randomId('collection');
  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granuleId1,
            collectionId: collectionId1,
          },
        }, {
          _source: {
            granuleId: granuleId1,
            collectionId: collectionId1,
          },
        }, {
          _source: {
            granuleId: granuleId1,
            collectionId: collectionId2,
          },
        },
        {
          _source: {
            granuleId: granuleId2,
            collectionId: collectionId2,
          },
        }],
        total: {
          value: 4,
        },
      },
    },
  });
  const returnedGranules = await getGranulesForPayload({
    query: 'fake-query',
    index: 'fake-index',
  });
  t.deepEqual(
    returnedGranules.sort(),
    [{ granuleId: granuleId1, collectionId: collectionId1 },
      { granuleId: granuleId1, collectionId: collectionId2 },
      { granuleId: granuleId2, collectionId: collectionId2 }].sort()
  );
});

test.serial('getGranulsForPayload handles query paging', async (t) => {
  const granuleId1 = randomId('granule');
  const granuleId2 = randomId('granule');
  const granuleId3 = randomId('granule');
  const collectionId = randomId('collection');
  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granuleId1,
            collectionId,
          },
        }, {
          _source: {
            granuleId: granuleId2,
            collectionId,
          },
        }],
        total: {
          value: 3,
        },
      },
    },
  });
  esScrollStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granuleId3,
            collectionId,
          },
        }],
        total: {
          value: 3,
        },
      },
    },
  });
  t.deepEqual(
    await getGranulesForPayload({
      query: 'fake-query',
      index: 'fake-index',
    }),
    [{ granuleId: granuleId1, collectionId },
      { granuleId: granuleId2, collectionId },
      { granuleId: granuleId3, collectionId }]
  );
});
