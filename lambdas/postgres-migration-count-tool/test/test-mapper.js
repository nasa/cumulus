const test = require('ava');
const sinon = require('sinon');

const {
  mapper,
} = require('../dist/lambda/mapper');

test('mapper returns expected values', async (t) => {
  const getElasticSearchCountStub = sinon.stub();
  getElasticSearchCountStub.onFirstCall().returns(Promise.resolve({
    body: '{"meta": { "count": 5 }}',
  }));
  getElasticSearchCountStub.onSecondCall().returns(Promise.resolve({
    body: '{"meta": { "count": 6 }}',
  }));
  getElasticSearchCountStub.onThirdCall().returns(Promise.resolve({
    body: '{"meta": { "count": 7 }}',
  }));

  const cutoffIsoString = 'cutoffIsoString';
  const cutoffTime = 123456;
  const knexClient = 'fakeKnexClient';
  const prefix = 'fakePrefix';
  const postgresCollectionId = 100;
  const collectionMap = {
    collection: {
      name: 'fakeCollection',
      version: '006',
    },
    postgresCollectionId,
  };

  const getPdrsFunction = () => Promise.resolve({
    body: '{"meta": { "count": 5 }}',
  });
  const listGranulesFunction = () => Promise.resolve({
    body: '{"meta": { "count": 6 }}',
  });
  const getExecutionsFunction = () => Promise.resolve({
    body: '{"meta": { "count": 7 }}',
  });
  const countPostgresPdrModelRecordsFunction = () => 1;
  const countPostgresGranuleModelRecordsFunction = () => 2;
  const countPostgresExecutionModelRecords = () => 3;

  const actual = await mapper({
    getPdrsFunction,
    listGranulesFunction,
    getExecutionsFunction,
    countPostgresPdrModelRecordsFunction,
    countPostgresGranuleModelRecordsFunction,
    countPostgresExecutionModelRecords,
    cutoffIsoString,
    cutoffTime,
    knexClient,
    prefix,
    collectionMap,
  });

  t.deepEqual({
    collectionId: 'fakeCollection___006',
    counts: [5, 6, 7, 1, 2, 3],
  }, actual);
});
