const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');

const { migrationDir } = require('../../../../lambdas/db-migration/dist/lambda');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  FilePgModel,
  QuerySearchClient,
  GranulePgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  getFilesAndGranuleInfoQuery,
} = require('../../dist');

test.before(async (t) => {
  t.context.testDbName = `query_client_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.filePgModel = new FilePgModel();
  t.context.granulePgModel = new GranulePgModel();

  const testCollection = fakeCollectionRecordFactory();
  const [collectionCumulusId] = await t.context.collectionPgModel.create(
    t.context.knex,
    testCollection
  );

  t.context.testGranule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  [t.context.granuleCumulusId] = await t.context.granulePgModel.create(
    t.context.knex,
    t.context.testGranule
  );
});

test.beforeEach((t) => {
  t.context.bucket = cryptoRandomString({ length: 5 });
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
  });
});

const createFileRecords = async ({
  granuleCumulusId,
  filePgModel,
  knex,
  bucket,
}, numOfFileRecords) => {
  const records = [...new Array(numOfFileRecords).keys()]
    .map((index) => ({
      bucket,
      key: `${index}_${cryptoRandomString({ length: 5 })}`,
      granule_cumulus_id: granuleCumulusId,
    }));
  await Promise.all(records.map((record) => filePgModel.create(knex, record)));
  return records;
};

test('QuerySearchClient.getNextRecord() returns next record from current set of results correctly', async (t) => {
  const { knex, bucket, testGranule } = t.context;

  const records = await createFileRecords(t.context, 2);

  const query = getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['cumulus_id'],
    granuleColumns: ['granule_id'],
  });
  const querySearchClient = new QuerySearchClient(
    query,
    5
  );
  t.like(
    await querySearchClient.getNextRecord(),
    {
      ...records[0],
      granule_cumulus_id: Number.parseInt(records[0].granule_cumulus_id, 10),
      granule_id: testGranule.granule_id,
    }
  );
  t.like(
    await querySearchClient.getNextRecord(),
    {
      ...records[1],
      granule_cumulus_id: Number.parseInt(records[1].granule_cumulus_id, 10),
      granule_id: testGranule.granule_id,
    }
  );
});

test('QuerySearchClient.getNextRecord() returns next record if next record must be fetched', async (t) => {
  const { knex, bucket, testGranule } = t.context;

  const records = await createFileRecords(t.context, 2);

  const query = getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['cumulus_id'],
    granuleColumns: ['granule_id'],
  });
  const querySearchClient = new QuerySearchClient(
    query,
    1
  );
  const queryOffsetSpy = sinon.spy(query, 'offset');
  const queryLimitSpy = sinon.spy(query, 'limit');

  t.like(
    await querySearchClient.getNextRecord(),
    {
      ...records[0],
      granule_cumulus_id: Number.parseInt(records[0].granule_cumulus_id, 10),
      granule_id: testGranule.granule_id,
    }
  );
  t.like(
    await querySearchClient.getNextRecord(),
    {
      ...records[1],
      granule_cumulus_id: Number.parseInt(records[1].granule_cumulus_id, 10),
      granule_id: testGranule.granule_id,
    }
  );
  t.is(queryOffsetSpy.callCount, 2);
  t.is(queryLimitSpy.callCount, 2);
});

test('QuerySearchClient.hasNextRecord() correctly returns true if next record exists in fetched results', async (t) => {
  const { knex, bucket } = t.context;

  await createFileRecords(t.context, 1);

  const query = getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['cumulus_id'],
    granuleColumns: ['granule_id'],
  });
  const fileSearchClient = new QuerySearchClient(
    query,
    1
  );
  t.true(
    await fileSearchClient.hasNextRecord()
  );
});

test('QuerySearchClient.hasNextRecord() correctly returns true if next record must be fetched', async (t) => {
  const { knex, bucket } = t.context;

  await createFileRecords(t.context, 2);

  const query = getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['cumulus_id'],
    granuleColumns: ['granule_id'],
  });
  const queryOffsetSpy = sinon.spy(query, 'offset');
  const queryLimitSpy = sinon.spy(query, 'limit');
  const fileSearchClient = new QuerySearchClient(
    query,
    1
  );

  t.true(
    await fileSearchClient.hasNextRecord()
  );
  await fileSearchClient.getNextRecord();
  t.true(
    await fileSearchClient.hasNextRecord()
  );
  t.is(queryOffsetSpy.callCount, 2);
  t.is(queryOffsetSpy.getCall(0).args[0], 0);
  t.is(queryOffsetSpy.getCall(1).args[0], 1);
  t.is(queryLimitSpy.callCount, 2);
  t.is(queryLimitSpy.getCall(0).args[0], 1);
  t.is(queryLimitSpy.getCall(1).args[0], 1);
});

test('QuerySearchClient.hasNextRecord() correctly returns false if next record does not exist in fetched results', async (t) => {
  const { knex, bucket } = t.context;

  const query = getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['cumulus_id'],
    granuleColumns: ['granule_id'],
  });
  const fileSearchClient = new QuerySearchClient(
    query,
    1
  );
  t.false(
    await fileSearchClient.hasNextRecord()
  );
});

test('QuerySearchClient pages through multiple sets of results', async (t) => {
  const { knex, bucket } = t.context;

  await createFileRecords(t.context, 3);

  const query = getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['cumulus_id'],
    granuleColumns: ['granule_id'],
  });
  const queryOffsetSpy = sinon.spy(query, 'offset');
  const queryLimitSpy = sinon.spy(query, 'limit');

  const querySearchClient = new QuerySearchClient(
    query,
    1
  );

  /* eslint-disable no-await-in-loop */
  while (await querySearchClient.hasNextRecord()) {
    await querySearchClient.getNextRecord();
  }
  /* eslint-enable no-await-in-loop */

  t.is(queryOffsetSpy.callCount, 4);
  t.is(queryOffsetSpy.getCall(0).args[0], 0);
  t.is(queryOffsetSpy.getCall(1).args[0], 1);
  t.is(queryOffsetSpy.getCall(2).args[0], 2);
  t.is(queryOffsetSpy.getCall(3).args[0], 3);
  t.is(queryLimitSpy.callCount, 4);
  t.is(queryLimitSpy.getCall(0).args[0], 1);
  t.is(queryLimitSpy.getCall(1).args[0], 1);
  t.is(queryLimitSpy.getCall(2).args[0], 1);
  t.is(queryLimitSpy.getCall(3).args[0], 1);
});
