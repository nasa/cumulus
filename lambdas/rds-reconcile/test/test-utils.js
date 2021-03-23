const test = require('ava');
const sinon = require('sinon');

const { generateAggregateReportObj, buildCollectionMappings, getEsCutoffQuery } = require('../dist/lambda/utils');

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
    asyncOperations: 0,
    collections: 1,
    providers: 2,
    rules: 3,
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
      {
        status: 'fulfilled',
        value: [dynamoCollections[0], 1],
      },
      {
        status: 'fulfilled',
        value: [dynamoCollections[1], 2],
      },
    ],
    actual.collectionMappings
  );

  const expectedError = new Error('Danger Will Robinson');
  expectedError.collection = 'BADCOLLECTION, 006';

  t.like({
    reason: expectedError,
    status: 'rejected',
  }, actual.failedCollectionMappings[0]);
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

test('getPostgresModelCutoffCount calls  ')

