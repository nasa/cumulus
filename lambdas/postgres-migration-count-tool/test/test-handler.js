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
  const getDynamoTableEntriesFunctionStub = () => [
    new Array(40),
    new Array(50),
    new Array(60),
  ];
  const getKnexClientStub = () => Promise.resolve({ val: true });
  const actual = await handler({
    countPostgresRecordsFunction: countPostgresRecordsFunctionStub,
    getDynamoTableEntriesFunction: getDynamoTableEntriesFunctionStub,
    getKnexClientFunction: getKnexClientStub,
  });

  const expected = {
    collectionsNotMapped: [],
    pdr_granule_and_execution_records_not_in_postgres_by_collection: {},
    records_in_dynamo_not_in_postgres: {
      totalDynamoAsyncOperations: 60,
      totalDynamoCollections: 0,
      totalDynamoProviders: 40,
      totalDynamoRules: 50,
      asyncOperationsDelta: 55,
      collectionsDelta: -5,
      providersDelta: 35,
      rulesDelta: 45,
    },
  };
  t.deepEqual(actual, expected);
});
