const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const { randomId } = require('@cumulus/common/test-utils');

const { fakeGranuleRecordFactory } = require('@cumulus/db');

const {
  CollectionPgModel,
  fakeCollectionRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
} = require('@cumulus/db');

const {
  getExecutionProcessingTimeInfo,
  moveGranuleFilesAndUpdateDatastore,
  getUniquePgGranuleByGranuleId,
} = require('../../lib/granules');

const { migrationDir } = require('../../../../lambdas/db-migration/dist/lambda');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;

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

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  // Create collection
  t.context.collectionPgModel = new CollectionPgModel();
  const collection = fakeCollectionRecordFactory({ name: 'collectionName', version: 'collectionVersion' });
  [t.context.collectionCumulusId] = await t.context.collectionPgModel.create(knex, collection);

  t.context.granulePgModel = new GranulePgModel();
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

test('getUniquePgGranuleByGranuleId() returns a single granule', async (t) => {
  const {
    knex,
    collectionCumulusId,
    granulePgModel,
  } = t.context;

  const fakeGranule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [granuleCumulusId] = await granulePgModel.create(knex, fakeGranule);

  const pgGranule = await granulePgModel.get(knex, { cumulus_id: granuleCumulusId });

  t.deepEqual(
    await getUniquePgGranuleByGranuleId(knex, granulePgModel, pgGranule.granule_id),
    pgGranule
  );
});

test('getUniquePgGranuleByGranuleId() throws an error if more than one granule is found', async (t) => {
  const {
    knex,
    collectionCumulusId,
    collectionPgModel,
    granulePgModel,
  } = t.context;

  const granuleId = 1;

  const collection = fakeCollectionRecordFactory({ name: 'collectionName2', version: 'collectionVersion2' });
  const [collectionCumulusId2] = await collectionPgModel.create(knex, collection);

  // 2 records. Same granule ID, different collections
  const fakeGranules = [
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      granule_id: granuleId,
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId2,
      granule_id: granuleId,
    }),
  ];

  const granuleIds = await Promise.all(fakeGranules.map((fakeGranule) =>
    granulePgModel.create(knex, fakeGranule)));

  const pgGranule = await granulePgModel.get(knex, { cumulus_id: granuleIds[0][0] });

  await t.throwsAsync(
    getUniquePgGranuleByGranuleId(knex, granulePgModel, pgGranule.granule_id),
    { instanceOf: Error }
  );
});

test('getUniquePgGranuleByGranuleId() throws an error if no granules are found', async (t) => {
  const {
    knex,
    granulePgModel,
  } = t.context;

  await t.throwsAsync(
    getUniquePgGranuleByGranuleId(knex, granulePgModel, 99999),
    { instanceOf: Error }
  );
});
