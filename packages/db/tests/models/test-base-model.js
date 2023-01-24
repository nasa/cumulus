const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const flatten = require('lodash/flatten');
const sortBy = require('lodash/sortBy');
const times = require('lodash/times');

const { RecordDoesNotExist } = require('@cumulus/errors');
const { removeNilProperties } = require('@cumulus/common/util');

const {
  localStackConnectionEnv,
  createRejectableTransaction,
  getKnexClient,
  BasePgModel,
} = require('../../dist');

const defaultDates = { created_at: new Date(), updated_at: new Date() };

test.before(async (t) => {
  t.context.knex = await getKnexClient({
    env: localStackConnectionEnv,
  });
  t.context.tableName = cryptoRandomString({ length: 10 });
  t.context.emptyTableName = 'getMaxIdEmptyTable';

  await t.context.knex.schema.createTable(t.context.tableName, (table) => {
    table.increments('cumulus_id').primary();
    table.text('info');
    table.timestamps(false, true);
  });
  await t.context.knex.schema.createTable(t.context.emptyTableName, (table) => {
    table.increments('cumulus_id').primary();
  });

  t.context.basePgModel = new BasePgModel({ tableName: t.context.tableName });
});

test.after.always(async (t) => {
  await t.context.knex.schema.dropTable(t.context.tableName);
  await t.context.knex.schema.dropTable(t.context.emptyTableName);
});

test('BasePgModel.create() creates record and returns cumulus_id by default', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });

  const queryResult = await basePgModel.create(knex, { ...defaultDates, info });

  const record = await knex(tableName).where({ info }).first();
  t.deepEqual(
    record,
    {
      ...defaultDates,
      cumulus_id: queryResult[0].cumulus_id,
      info,
    }
  );
});

test('BasePgModel.create() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });

  const queryResult = await createRejectableTransaction(knex, (trx) =>
    basePgModel.create(trx, { ...defaultDates, info }));

  const record = await knex(tableName).where({ info }).first();
  t.deepEqual(
    record,
    {
      ...defaultDates,
      cumulus_id: queryResult[0].cumulus_id,
      info,
    }
  );
});

test('BasePgModel.insert() creates records and returns cumulus_id by default', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const info2 = cryptoRandomString({ length: 5 });

  const queryResult = await basePgModel.insert(knex, [
    { ...defaultDates, info },
    { ...defaultDates, info: info2 },
  ]);

  const records = await knex(tableName).whereIn('info', [info, info2]).orderBy('info');
  t.deepEqual(
    sortBy(records, ['cumulus_id']),
    sortBy([{
      ...defaultDates,
      cumulus_id: queryResult[0].cumulus_id,
      info,
    },
    {
      ...defaultDates,
      cumulus_id: queryResult[1].cumulus_id,
      info: info2,
    }], ['cumulus_id'])
  );
});

test('BasePgModel.insert() creates records and returns specified fields', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const info2 = cryptoRandomString({ length: 5 });

  const insertedRecords = await basePgModel.insert(
    knex,
    [
      { ...defaultDates, info },
      { ...defaultDates, info: info2 },
    ],
    '*'
  );

  const records = await knex(tableName).whereIn('info', [info, info2]).orderBy('info');
  t.deepEqual(
    sortBy(records, ['info']),
    sortBy(insertedRecords, ['info'])
  );
});

test('BasePgModel.insert() works with transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const info2 = cryptoRandomString({ length: 5 });

  let queryResult;
  await createRejectableTransaction(knex, async (trx) => {
    queryResult = await basePgModel.insert(trx, [
      { ...defaultDates, info },
      { ...defaultDates, info: info2 },
    ]);
  });

  const records = await knex(tableName).whereIn('info', [info, info2]).orderBy('info');
  t.deepEqual(
    sortBy(records, ['cumulus_id']),
    sortBy([{
      ...defaultDates,
      cumulus_id: queryResult[0].cumulus_id,
      info,
    },
    {
      ...defaultDates,
      cumulus_id: queryResult[1].cumulus_id,
      info: info2,
    }], ['cumulus_id'])
  );
});

test('BasePgModel.get() returns correct record', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ ...defaultDates, info });
  t.like(
    await basePgModel.get(knex, { info }),
    { ...defaultDates, info }
  );
});

test('BasePgModel.get() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ ...defaultDates, info });
  t.like(
    await createRejectableTransaction(knex, (trx) => basePgModel.get(trx, { info })),
    {
      ...defaultDates,
      info,
    }
  );
});

test('BasePgModel.get() throws an error when a record is not found', async (t) => {
  const { knex, basePgModel } = t.context;
  const info = cryptoRandomString({ length: 10 });
  await t.throwsAsync(
    createRejectableTransaction(knex, (trx) => basePgModel.get(trx, { info })),
    { instanceOf: RecordDoesNotExist }
  );
});

test('BasePgModel.getRecordCumulusId() returns correct value', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const [record] = await knex(tableName)
    .insert({ info })
    .returning('cumulus_id');
  t.is(
    await basePgModel.getRecordCumulusId(knex, { info }),
    record.cumulus_id
  );
});

test('BasePgModel.getRecordCumulusId() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const [record] = await knex(tableName)
    .insert({ info })
    .returning('cumulus_id');
  t.is(
    await createRejectableTransaction(
      knex,
      (trx) => basePgModel.getRecordCumulusId(trx, { info })
    ),
    record.cumulus_id
  );
});

test('BasePgModel.getRecordCumulusId() throws RecordDoesNotExist error for missing record', async (t) => {
  const { knex, basePgModel } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await t.throwsAsync(
    basePgModel.getRecordCumulusId(knex, { info }),
    { instanceOf: RecordDoesNotExist }
  );
});

test('BasePgModel.getRecordsCumulusIds() returns correct values', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info1 = cryptoRandomString({ length: 5 });
  const info2 = cryptoRandomString({ length: 5 });
  const records = await knex(tableName)
    .insert([{ info: info1 }, { info: info2 }])
    .returning('cumulus_id');
  t.is(records.length, 2);
  t.deepEqual(
    await basePgModel.getRecordsCumulusIds(knex, ['info'], [info1, info2]),
    records.map((record) => record.cumulus_id)
  );
});

test('BasePgModel.getRecordsCumulusIds() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info1 = cryptoRandomString({ length: 5 });
  const info2 = cryptoRandomString({ length: 5 });
  const records = await knex(tableName)
    .insert([{ info: info1 }, { info: info2 }])
    .returning('cumulus_id');
  const recordsCumulusIds = records.map((record) => record.cumulus_id);
  t.is(recordsCumulusIds.length, 2);
  t.deepEqual(
    await createRejectableTransaction(
      knex,
      (trx) => basePgModel.getRecordsCumulusIds(trx, ['info'], [info1, info2])
    ),
    recordsCumulusIds
  );
});

test('BasePgModel.exists() correctly returns true', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ info });
  t.true(await basePgModel.exists(knex, { info }));
});

test('BasePgModel.exists() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ info });
  t.true(await createRejectableTransaction(
    knex,
    (trx) => basePgModel.exists(trx, { info })
  ));
});

test('BasePgModel.exists() correctly returns false', async (t) => {
  const { knex, basePgModel } = t.context;
  const info = cryptoRandomString({ length: 5 });
  t.false(await basePgModel.exists(knex, { info }));
});

test('BasePgModel.delete() correctly deletes records', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });

  // Insert the records and validate that they exists in the table
  const [[record1], [record2]] = await Promise.all([
    knex(tableName)
      .insert({ info })
      .returning('cumulus_id'),
    knex(tableName)
      .insert({ info })
      .returning('cumulus_id'),
  ]);

  t.true(await basePgModel.exists(knex, { cumulus_id: record1.cumulus_id }));
  t.true(await basePgModel.exists(knex, { cumulus_id: record2.cumulus_id }));

  // Delete the records and validate that they're gone
  t.is(
    await basePgModel.delete(knex, { info }),
    2
  );

  t.false(await basePgModel.exists(knex, { cumulus_id: record1.cumulus_id }));
  t.false(await basePgModel.exists(knex, { cumulus_id: record2.cumulus_id }));
});

test('BasePgModel.count() returns valid counts', async (t) => {
  const { knex, basePgModel, tableName } = t.context;

  await knex(tableName)
    .insert({ info: 1 })
    .returning('cumulus_id');

  await knex(tableName)
    .insert({ info: 2 })
    .returning('cumulus_id');

  await knex(tableName)
    .insert({ info: 3 })
    .returning('cumulus_id');

  t.deepEqual(await createRejectableTransaction(
    knex,
    (trx) => basePgModel.count(trx, [[{ info: 2 }]])
  ), [{ count: '1' }]);

  t.deepEqual(await createRejectableTransaction(
    knex,
    (trx) => basePgModel.count(trx, [['info', '=', '2']])
  ), [{ count: '1' }]);
});

test('BasePgModel.delete() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });

  const [record] = await knex(tableName)
    .insert({ info })
    .returning('cumulus_id');

  t.is(await createRejectableTransaction(
    knex,
    (trx) => basePgModel.delete(trx, { cumulus_id: record.cumulus_id })
  ), 1);

  // validate that the record is not in the table
  t.false(await basePgModel.exists(knex, { cumulus_id: record.cumulus_id }));
});

test('BasePgModel.queryBuilderSearch returns an awaitable knex Builder object', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const recordBody = { info };

  await Promise.all([
    knex(tableName).insert(recordBody),
    knex(tableName).insert(recordBody),
    knex(tableName).insert(recordBody),
  ]);

  const queryBuilderSearchResult = basePgModel.queryBuilderSearch(knex, recordBody);
  queryBuilderSearchResult.limit(2);
  const searchResponse = await queryBuilderSearchResult;
  t.is(searchResponse.length, 2);
  searchResponse.forEach((r) => {
    t.like(r, recordBody);
  });
});

test('BasePgModel.search() returns an array of records', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const recordBody = { info };

  await Promise.all([
    knex(tableName).insert(recordBody),
    knex(tableName).insert(recordBody),
    knex(tableName).insert(recordBody),
  ]);

  const searchResponse = await basePgModel.search(knex, recordBody);

  t.is(searchResponse.length, 3);

  searchResponse.forEach((r) => {
    t.like(r, recordBody);
  });
});

test('BasePgModel.search() returns an empty array if nothing found', async (t) => {
  const { knex, basePgModel } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const recordBody = { info };

  const searchResponse = await basePgModel.search(knex, recordBody);

  t.deepEqual(searchResponse, []);
});

test('BasePgModel.search() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const recordBody = { info };

  await Promise.all([
    knex(tableName).insert(recordBody),
    knex(tableName).insert(recordBody),
    knex(tableName).insert(recordBody),
  ]);

  const searchResponse = await createRejectableTransaction(knex, async (trx) =>
    await basePgModel.search(trx, recordBody));

  t.is(searchResponse.length, 3);

  searchResponse.forEach((r) => {
    t.like(r, recordBody);
  });
});

test('BasePgModel.update() updates provided fields on a record', async (t) => {
  const {
    knex,
    basePgModel,
    tableName,
  } = t.context;

  // Create initial record
  const info = cryptoRandomString({ length: 5 });
  const [initialRecord] = await basePgModel.create(knex, { info });

  // Update record
  const newInfo = cryptoRandomString({ length: 5 });
  await basePgModel.update(
    knex,
    { cumulus_id: initialRecord.cumulus_id },
    { ...defaultDates, info: newInfo }
  );

  const record = await knex(tableName).where({ cumulus_id: initialRecord.cumulus_id }).first();
  t.deepEqual(
    record,
    {
      ...defaultDates,
      cumulus_id: initialRecord.cumulus_id,
      info: newInfo,
    }
  );
});

test('BasePgModel.update() returns only specified fields if provided', async (t) => {
  const {
    knex,
    basePgModel,
  } = t.context;

  // Create initial record
  const info = cryptoRandomString({ length: 5 });
  const [initialRecord] = await basePgModel.create(knex, { info });

  // Update record
  const newInfo = cryptoRandomString({ length: 5 });
  const updatedFields = await basePgModel.update(
    knex,
    { cumulus_id: initialRecord.cumulus_id }, { info: newInfo }, ['info']
  );

  t.deepEqual(
    updatedFields,
    [{ info: newInfo }]
  );
});

test('BasePgModel.update() works with a knex transaction', async (t) => {
  const {
    knex,
    basePgModel,
    tableName,
  } = t.context;

  // Create initial record
  const info = cryptoRandomString({ length: 5 });
  const [initialRecord] = await basePgModel.create(knex, { info });

  // Update record
  const newInfo = cryptoRandomString({ length: 5 });

  // Use existing transation rather than knex client
  await createRejectableTransaction(knex, async (trx) =>
    await basePgModel.update(
      trx,
      { cumulus_id: initialRecord.cumulus_id },
      { ...defaultDates, info: newInfo }
    ));

  const record = await knex(tableName).where({ cumulus_id: initialRecord.cumulus_id }).first();
  t.deepEqual(
    record,
    {
      ...defaultDates,
      cumulus_id: initialRecord.cumulus_id,
      info: newInfo,
    }
  );
});

test('BasePgModel.searchWithUpdatedAtRange() returns an array of records if no date range specified', async (t) => {
  const {
    knex,
    basePgModel,
  } = t.context;

  const info = cryptoRandomString({ length: 5 });

  const records = times(3, () => ({
    info,
  }));
  await Promise.all(records.map((r) => basePgModel.create(knex, r)));
  const searchResponse = await basePgModel.searchWithUpdatedAtRange(
    knex,
    { info },
    {}
  );

  t.is(searchResponse.length, 3);
});

test('BasePgModel.searchWithUpdatedAtRange() returns a filtered array of records if a date range is specified', async (t) => {
  const {
    knex,
    basePgModel,
  } = t.context;

  const info = cryptoRandomString({ length: 5 });

  const records = times(3, () => ({
    info,
    updated_at: new Date(),
  }));

  const dateValue = 5000;
  const searchRecord = ({
    info,
    updated_at: new Date(dateValue),
  });
  records.push(searchRecord);

  await Promise.all(records.map((r) => basePgModel.create(knex, r)));

  const searchResponse = await basePgModel.searchWithUpdatedAtRange(
    knex,
    {
      info,
    },
    {
      updatedAtFrom: new Date(dateValue - 1),
      updatedAtTo: new Date(dateValue + 1),
    }
  );

  t.is(searchResponse.length, 1);
  t.like(
    removeNilProperties(searchResponse[0]),
    searchRecord
  );
});

test('BasePgModel.searchWithUpdatedAtRange() returns a filtered array of records if only updatedAtTo is specified', async (t) => {
  const {
    knex,
    basePgModel,
  } = t.context;

  const dateValue = 5000;
  const info = cryptoRandomString({ length: 5 });
  const records = times(3, () => ({
    info,
    updated_at: new Date(),
  }));

  const searchRecord = ({
    info,
    updated_at: new Date(dateValue),
  });
  records.push(searchRecord);

  await Promise.all(records.map((r) => basePgModel.create(knex, r)));

  const searchResponse = await basePgModel.searchWithUpdatedAtRange(
    knex,
    {
      info,
    },
    {
      updatedAtTo: new Date(dateValue + 1),
    }
  );

  t.is(searchResponse.length, 1);
  t.like(
    removeNilProperties(searchResponse[0]),
    searchRecord
  );
});

test('BasePgModel.searchWithUpdatedAtRange() returns a filtered array of records if only updatedAtFrom is specified', async (t) => {
  const {
    knex,
    basePgModel,
  } = t.context;

  const nowDateValue = new Date().valueOf();
  const info = cryptoRandomString({ length: 5 });
  const records = times(3, () => ({
    info,
    updated_at: new Date(nowDateValue - 10000),
  }));

  const searchRecord = ({
    updated_at: new Date(nowDateValue),
    info,
  });
  records.push(searchRecord);

  await Promise.all(records.map((r) => basePgModel.create(knex, r)));

  const searchResponse = await basePgModel.searchWithUpdatedAtRange(
    knex,
    {
      info,
    },
    {
      updatedAtFrom: new Date(nowDateValue - 1),
    }
  );

  t.is(searchResponse.length, 1);
  t.like(
    removeNilProperties(searchResponse[0]),
    searchRecord
  );
});

test.serial('BasePgModel.paginateByCumulusId() returns paginatedValues', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info1 = cryptoRandomString({ length: 5 });
  const info2 = cryptoRandomString({ length: 5 });
  const records = await knex(tableName)
    .insert([{ info: info1 }, { info: info2 }])
    .returning('cumulus_id');
  const recordIds = records.map((record) => record.cumulus_id);

  const firstPageRecords = await basePgModel.paginateByCumulusId(
    knex, recordIds[0], 1
  );
  const secondPageRecords = await basePgModel.paginateByCumulusId(
    knex, recordIds[1], 1
  );

  t.is(firstPageRecords.length, 1);
  t.is(secondPageRecords.length, 1);
  t.deepEqual(firstPageRecords[0].info, info1);
  t.deepEqual(secondPageRecords[0].info, info2);
});

test.serial('BasePgModel.paginateByCumulusId() returns muliple value pages', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const testLength = 5;
  await Promise.all(new Array(testLength).fill().map((_i) => knex(tableName)
    .insert({ info: cryptoRandomString({ length: 20 }) })
    .returning('cumulus_id')));
  const firstPageRecords = await basePgModel.paginateByCumulusId(
    knex, 1, 3
  );
  const secondPageRecords = await basePgModel.paginateByCumulusId(
    knex, 4, 2
  );
  t.is(firstPageRecords.length, 3);
  t.is(secondPageRecords.length, 2);
});

test.serial('getMaxId returns the next cumulus_id in sequence', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const expected = await knex(tableName).max('cumulus_id').first();
  const result = await basePgModel.getMaxCumulusId(knex);
  t.is(result, expected.max);
});

test('getMaxId throws if knex call returns undefined ', async (t) => {
  const { basePgModel, tableName } = t.context;
  const knexMock = () => ({
    max: (_id) => ({
      first: () => undefined,
    }),
  });
  await t.throwsAsync(basePgModel.getMaxCumulusId(knexMock), {
    message:
      `Invalid .max "cumulus_id" query on ${tableName}, MAX cumulus_id cannot be returned`,
  });
});

test('deleteExcluding deletes records, filtering on excluded cumulus_ids', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const testLength = 5;
  const objectPayload = { info: 'baseModelExcluding' };
  const insertedRecords = flatten(
    await Promise.all(
      new Array(testLength)
        .fill()
        .map((_i) => knex(tableName).insert(objectPayload).returning('*'))
    )
  );
  await basePgModel.deleteExcluding({
    knexOrTransaction: knex,
    excludeCumulusIds: [insertedRecords[0].cumulus_id],
    queryParams: objectPayload,
  });

  const actualRecords = await basePgModel.search(
    knex,
    {
      info: 'baseModelExcluding',
    }
  );
  t.deepEqual(actualRecords, [insertedRecords[0]]);
});

test('deleteExcluding throws if missing explicit query params', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const testLength = 5;
  const objectPayload = { info: 'baseModelExcluding' };
  const insertedRecords = await Promise.all(
    new Array(testLength)
      .fill()
      .map((_i) => knex(tableName).insert(objectPayload).returning('*'))
  );
  await t.throwsAsync(
    basePgModel.deleteExcluding({
      knexOrTransaction: knex,
      excludeCumulusIds: [flatten(insertedRecords)[0].cumulus_id],
    }),
    { name: 'TypeError' }
  );
});
