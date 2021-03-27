const test = require('ava');
const sinon = require('sinon');

const {
  buildCollectionMappings,
  countPostgresRecords,
  generateAggregateReportObj,
  generateCollectionReportObj,
  getDbCount,
  getDynamoTableEntries,
  getEsCutoffQuery,
} = require('../dist/lambda/utils');

test('generateAggregateReportObj returns the expected results', (t) => {
  const dynamoAsyncOperationsCount = 1;
  const dynamoCollectionsCount = 2;
  const dynamoProvidersCount = 3;
  const dynamoRuleCount = 4;
  const postgresAsyncOperationsCount = 1;
  const postgresCollectionCount = 1;
  const postgresProviderCount = 1;
  const postgresRulesCount = 1;

  const result = generateAggregateReportObj({
    dynamoAsyncOperationsCount,
    dynamoCollectionsCount,
    dynamoProvidersCount,
    dynamoRuleCount,
    postgresAsyncOperationsCount,
    postgresCollectionCount,
    postgresProviderCount,
    postgresRulesCount,
  });

  t.deepEqual(result, {
    asyncOperationsDelta: 0,
    collectionsDelta: 1,
    providersDelta: 2,
    rulesDelta: 3,
    totalDynamoAsyncOperations: 1,
    totalDynamoCollections: 2,
    totalDynamoProviders: 3,
    totalDynamoRules: 4,
  });
});

test('buildCollectionMappings returns the expected mappings', async (t) => {
  let collectionIdIncrement = 0;
  const dynamoCollections = [
    {
      name: 'FAKECOLLECTION',
      version: '006',
    },
    {
      name: 'FAKECOLLECTION2',
      version: '006',
    },
    {
      name: 'BADCOLLECTION',
      version: '006',
    },
  ];

  const collectionModelMock = {
    get: async (_knex, collection) => {
      if (collection.name === 'BADCOLLECTION') {
        throw new Error('Danger Will Robinson');
      }
      collectionIdIncrement += 1;
      return { cumulus_id: collectionIdIncrement };
    },
  };
  const actual = await buildCollectionMappings(
    dynamoCollections,
    collectionModelMock,
    {},
    (collection) => ({
      name: collection.name,
      version: collection.version,
    })
  );

  t.deepEqual(
    [
      { collection: dynamoCollections[0],
        postgresCollectionId: 1,
      },
      { collection: dynamoCollections[1],
        postgresCollectionId: 2,
      },
    ],
    actual.collectionValues
  );

  const expectedError = new Error('Danger Will Robinson');
  expectedError.collection = 'BADCOLLECTION, 006';

  t.deepEqual(expectedError, actual.collectionFailures[0]);
});

test('getEsCutoffQuery returns the expected query if a collectionId is specified', (t) => {
  const actual = getEsCutoffQuery(['foo', 'bar'], 1000, '500');
  const expected = {
    collectionId: '500',
    createdAt__to: '1000',
    fields: [
      'foo',
      'bar',
    ],
  };

  t.deepEqual(actual, expected);
});

test('getEsCutoffQuery returns the expected query if a collectionId is not specified', (t) => {
  const actual = getEsCutoffQuery(['foo', 'bar'], 1000);
  const expected = {
    createdAt__to: '1000',
    fields: [
      'foo',
      'bar',
    ],
  };

  t.deepEqual(actual, expected);
});

test('countPostgresRecords calls the model with the expected query string', async (t) => {
  const modelCountSpy = sinon.spy(() => [{ count: 1 }]);
  const modelStub = {
    count: modelCountSpy,
  };
  const knexClient = {};
  const queryParams = ['fakeQueryParams'];

  const actual = await countPostgresRecords({
    model: modelStub,
    knexClient,
    cutoffIsoString: 'fakeCutoffIsoString',
    queryParams,
  });

  t.is(actual, 1);
  modelCountSpy.calledWith(knexClient, queryParams);
});

test('getDbCount returns the count from the query result promise', async (t) => {
  const resultPromise = Promise.resolve({ body: '{"meta": { "count": 10}}' });
  const actual = await getDbCount(resultPromise);
  t.is(actual, 10);
});

test('generateCollectionReportObj generates a report object', (t) => {
  const statsObjects = [
    { collectionId: 'fakeCollectionId', counts: [7, 8, 9, 4, 5, 6] },
  ];
  const actual = generateCollectionReportObj(statsObjects);
  const expected = {
    fakeCollectionId: {
      executionsDelta: 3,
      granulesDelta: 3,
      pdrsDelta: 3,
      totalExecutions: 9,
      totalGranules: 8,
      totalPdrs: 7,
    },
  };
  t.deepEqual(actual, expected);
});

test('generateCollectionReportObj does not return a report object if there are no discrepancies', (t) => {
  const statsObjects = [{
    collectionId: 'fakeCollectionId',
    counts: [1, 1, 1, 1, 1, 1],
  }];
  const actual = generateCollectionReportObj(statsObjects);
  const expected = {};
  t.deepEqual(actual, expected);
});

test('getDynamoTableEntries calls the correct model methods', async (t) => {
  const getAllSpy = sinon.spy(async () => true);
  const modelStub = {
    getAllCollections: getAllSpy,
    getAllProviders: getAllSpy,
    getAllRules: getAllSpy,
    getAllAsyncOperations: getAllSpy,
  };
  await getDynamoTableEntries({
    dynamoCollectionModel: modelStub,
    dynamoProvidersModel: modelStub,
    dynamoRulesModel: modelStub,
    dynamoAsyncOperationsModel: modelStub,
  });
  t.is(getAllSpy.callCount, 4);
});
