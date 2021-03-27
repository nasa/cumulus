const test = require('ava');

// eslint-disable-next-line unicorn/import-index
const { handler } = require('../dist/lambda/index');

test('handler returns the expected report', async (t) => {
  process.env.systemBucket = 'fake_bucket';
  process.env.prefix = 'fakePrefix';
  process.env.GranulesTable = 'GranulesTable';
  process.env.ProvidersTable = 'ProvidersTable';
  process.env.RulesTable = 'RulesTable';
  process.env.CollectionsTable = 'CollectionsTable';
  process.env.AsyncOperationsTable = 'AsyncOperationsTable';
  const countPostgresRecordsFunctionStub = () => 5;
  const mapperFunctionStub = (_val) => ({
    collectionId: 'TEST_COLLECTION__006',
    counts: [10, 10, 10, 0, 0, 0],
  });
  const buildCollectionMappingsFunctionStub = () => ({
    collectionValues: [{
      collection: 'TEST_COLLECTION__006',
      postgresCollectionId: 1,
    }],
    collectionFailures: ['fake collection failures object'],
  });
  const getDynamoTableEntriesFunctionStub = () => [
    new Array(40),
    new Array(50),
    new Array(60),
    new Array(1000),
  ];
  const getKnexClientStub = async () => ({ val: true });
  const actual = await handler({
    countPostgresRecordsFunction: countPostgresRecordsFunctionStub,
    mapperFunction: mapperFunctionStub,
    buildCollectionMappingsFunction: buildCollectionMappingsFunctionStub,
    getDynamoTableEntriesFunction: getDynamoTableEntriesFunctionStub,
    getKnexClientFunction: getKnexClientStub,
  });

  const expected = {
    collectionsNotMapped: [
      'fake collection failures object',
    ],
    pdr_granule_and_execution_records_not_in_postgres_by_collection: {
      TEST_COLLECTION__006: {
        executionsDelta: 10,
        granulesDelta: 10,
        pdrsDelta: 10,
        totalExecutions: 10,
        totalGranules: 10,
        totalPdrs: 10,
      },
    },
    records_in_dynamo_not_in_postgres: {
      totalDynamoAsyncOperations: 1000,
      totalDynamoCollections: 40,
      totalDynamoProviders: 50,
      totalDynamoRules: 60,
      asyncOperationsDelta: 995,
      collectionsDelta: 35,
      providersDelta: 45,
      rulesDelta: 55,
    },
    s3Uri: '',
  };
  t.deepEqual(actual, expected);
});
