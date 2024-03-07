const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');
const orderBy = require('lodash/orderBy');

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
  migrationDir,
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
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    testCollection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  t.context.testGranule = fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
  });
  const [pgGranule] = await t.context.granulePgModel.create(
    t.context.knex,
    t.context.testGranule
  );
  t.context.granuleCumulusId = pgGranule.cumulus_id;
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
  const insertRecords = [...new Array(numOfFileRecords).keys()]
    .map((index) => ({
      bucket,
      key: `${index}_${cryptoRandomString({ length: 5 })}`,
      granule_cumulus_id: granuleCumulusId,
    }));
  const records = await filePgModel.insert(
    knex,
    insertRecords,
    '*'
  );
  return records;
};

test('QuerySearchClient.shift() returns next record from current set of results correctly', async (t) => {
  const { knex, bucket, testGranule } = t.context;

  const records = orderBy(await createFileRecords(t.context, 2), ['cumulus_id']);

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
    await querySearchClient.shift(),
    {
      ...records[0],
      granule_cumulus_id: records[0].granule_cumulus_id,
      granule_id: testGranule.granule_id,
    }
  );
  t.like(
    await querySearchClient.shift(),
    {
      ...records[1],
      granule_cumulus_id: records[1].granule_cumulus_id,
      granule_id: testGranule.granule_id,
    }
  );
});

test('QuerySearchClient.shift() returns next record if next record must be fetched', async (t) => {
  const { knex, bucket, testGranule } = t.context;

  const records = orderBy(await createFileRecords(t.context, 2), ['cumulus_id']);

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
    await querySearchClient.shift(),
    {
      ...records[0],
      granule_cumulus_id: records[0].granule_cumulus_id,
      granule_id: testGranule.granule_id,
    }
  );
  t.like(
    await querySearchClient.shift(),
    {
      ...records[1],
      granule_cumulus_id: records[1].granule_cumulus_id,
      granule_id: testGranule.granule_id,
    }
  );
  t.is(queryOffsetSpy.callCount, 2);
  t.is(queryLimitSpy.callCount, 2);
});

test('QuerySearchClient.peek() correctly returns the next record in the fetched results, if any', async (t) => {
  const { knex, bucket } = t.context;

  const records = await createFileRecords(t.context, 1);

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
  t.like(
    await fileSearchClient.peek(),
    records[0]
  );
});

test('QuerySearchClient.peek() correctly returns next record when more records must be fetched', async (t) => {
  const { knex, bucket } = t.context;

  const records = orderBy(await createFileRecords(t.context, 2), ['cumulus_id']);

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

  t.like(
    await fileSearchClient.peek(),
    records[0]
  );
  await fileSearchClient.shift();
  t.like(
    await fileSearchClient.peek(),
    records[1]
  );
  t.is(queryOffsetSpy.callCount, 2);
  t.is(queryOffsetSpy.getCall(0).args[0], 0);
  t.is(queryOffsetSpy.getCall(1).args[0], 1);
  t.is(queryLimitSpy.callCount, 2);
  t.is(queryLimitSpy.getCall(0).args[0], 1);
  t.is(queryLimitSpy.getCall(1).args[0], 1);
});

test('QuerySearchClient.peek() correctly returns undefined if next record does not exist in fetched results', async (t) => {
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
  t.is(
    await fileSearchClient.peek(),
    undefined
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
  while (await querySearchClient.peek()) {
    await querySearchClient.shift();
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

test.serial('QuerySearchClient.peek() retries if fetchRecords fails with connection terminated error', async (t) => {
  const queryBuilderStub = {
    offset: sinon.stub().returnsThis(),
    limit: sinon.stub().rejects(new Error('Connection terminated unexpectedly')),
  };
  t.teardown(() => sinon.restore());

  const fileSearchClient = new QuerySearchClient(
    queryBuilderStub,
    1
  );

  const error = await t.throwsAsync(
    fileSearchClient.fetchRecords(),
    { message: 'Connection terminated unexpectedly' }
  );
  t.is(error.attemptNumber, 4);
});
