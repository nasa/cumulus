const test = require('ava');
const moment = require('moment');
const cryptoRandomString = require('crypto-random-string');
const { randomId } = require('@cumulus/common/test-utils');

const {
  CollectionPgModel,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  GranulePgModel,
  GranulesExecutionsPgModel,
  migrationDir,
  createRejectableTransaction,
} = require('../../dist');

const testDbName = `execution_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();
});

test.beforeEach((t) => {
  t.context.executionRecord = fakeExecutionRecordFactory();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('ExecutionPgModel.upsert() creates new running execution if writeConstraints is set to true', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'running';

  await executionPgModel.upsert(knex, executionRecord, true);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    executionRecord
  );
});

test('ExecutionPgModel.upsert() creates new running execution if writeConstraints is set to false', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'running';

  await executionPgModel.upsert(knex, executionRecord, false);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    executionRecord
  );
});

test('ExecutionPgModel.upsert() updates only allowed fields for a running execution if writeConstraints is set to true and write conditions are met', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'completed';
  executionRecord.workflow_name = 'workflow-1';
  executionRecord.url = randomId('url-1');
  executionRecord.final_payload = {
    key1: 'value',
  };
  await executionPgModel.create(knex, executionRecord);

  const updatedRecord = {
    ...executionRecord,
    status: 'running',
    created_at: new Date(),
    updated_at: new Date(),
    timestamp: new Date(),
    original_payload: {
      foo: 'bar',
    },
    final_payload: null,
    workflow_name: 'workflow-2',
    url: randomId('url-2'),
  };

  await executionPgModel.upsert(knex, updatedRecord);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    {
      ...updatedRecord,
      status: executionRecord.status,
      workflow_name: executionRecord.workflow_name,
      url: executionRecord.url,
      final_payload: executionRecord.final_payload,
    }
  );
});

test('ExecutionPgModel.upsert() updates all fields for a running execution if writeConstraints is set to false', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'completed';
  executionRecord.workflow_name = 'workflow-1';
  executionRecord.url = randomId('url-1');
  executionRecord.final_payload = {
    key1: 'value',
  };
  await executionPgModel.create(knex, executionRecord);

  const updatedRecord = {
    ...executionRecord,
    status: 'running',
    created_at: new Date(),
    updated_at: new Date(),
    timestamp: new Date(),
    original_payload: {
      foo: 'bar',
    },
    final_payload: null,
    workflow_name: 'workflow-2',
    url: randomId('url-2'),
  };

  await executionPgModel.upsert(knex, updatedRecord, false);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    updatedRecord
  );
});

test('ExecutionPgModel.upsert() creates new completed execution', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'completed';

  await executionPgModel.upsert(knex, executionRecord);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    executionRecord
  );
});

test('ExecutionPgModel.upsert() updates a completed execution', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'completed';
  executionRecord.original_payload = {
    key1: 'original',
  };
  executionRecord.final_payload = {
    key1: 'value',
  };
  await executionPgModel.create(knex, executionRecord);

  const updatedRecord = {
    ...executionRecord,
    final_payload: {
      key2: 'value',
    },
    original_payload: null,
  };
  await executionPgModel.upsert(knex, updatedRecord);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    updatedRecord
  );
});

test('ExecutionPgModel.upsert() will not allow a running execution to replace a completed execution if writeConstraints is set to true ', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'completed';
  await executionPgModel.create(knex, executionRecord);

  const updatedRecord = {
    ...executionRecord,
    status: 'running',
  };
  await executionPgModel.upsert(knex, updatedRecord);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    executionRecord
  );
});

test('ExecutionPgModel.upsert() will allow a running execution to replace a completed execution if writeConstraints is set to false ', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'completed';
  await executionPgModel.create(knex, executionRecord);

  const updatedRecord = {
    ...executionRecord,
    status: 'running',
  };
  await executionPgModel.upsert(knex, updatedRecord, false);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    updatedRecord
  );
});

test('ExecutionPgModel.create() will not allow an execution with an original_payload that is an array to be written', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.original_payload = ['test1', 'test2'];
  await t.throwsAsync(executionPgModel.create(knex, executionRecord));
});

test('ExecutionPgModel.create() will not allow an execution with an final_payload that is an array to be written', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.final_payload = ['test1', 'test2'];
  await t.throwsAsync(executionPgModel.create(knex, executionRecord));
});

test('ExecutionPgModel.delete() deletes execution and granule/execution join records', async (t) => {
  const {
    knex,
    collectionPgModel,
    granulesExecutionsPgModel,
    executionPgModel,
    granulePgModel,
    executionRecord,
  } = t.context;

  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  const [pgGranule] = await granulePgModel.create(knex, fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
  }));
  const granuleCumulusId = pgGranule.cumulus_id;

  const executionCumulusId = await createRejectableTransaction(knex, async (trx) => {
    const [executionCreateResponse] = await executionPgModel.create(trx, executionRecord);
    await granulesExecutionsPgModel.create(trx, {
      execution_cumulus_id: executionCreateResponse.cumulus_id,
      granule_cumulus_id: granuleCumulusId,
    });
    return executionCreateResponse.cumulus_id;
  });

  t.true(
    await executionPgModel.exists(
      knex,
      executionRecord
    )
  );
  t.true(
    await granulesExecutionsPgModel.exists(
      knex,
      {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      }
    )
  );

  await createRejectableTransaction(
    knex,
    (trx) => executionPgModel.delete(
      trx,
      executionRecord
    )
  );

  t.false(
    await executionPgModel.exists(
      knex,
      executionRecord
    )
  );
  t.false(
    await granulesExecutionsPgModel.exists(
      knex,
      {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      }
    )
  );
});

test('ExecutionPgModel.searchByCumulusIds() returns correct values', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;
  const executionRecords = [fakeExecutionRecordFactory(), executionRecord];
  let execution1;
  let execution2;
  await createRejectableTransaction(knex, async (trx) => {
    [execution1] = await executionPgModel.create(trx, executionRecords[0]);
    [execution2] = await executionPgModel.create(trx, executionRecords[1]);
  });
  const executionCumulusId1 = execution1.cumulus_id;
  const executionCumulusId2 = execution2.cumulus_id;

  const results = await executionPgModel
    .searchByCumulusIds(knex, [executionCumulusId1, executionCumulusId2]);

  results.forEach((result, index) => t.like(result, executionRecords[index]));
});

test('ExecutionPgModel.searchByCumulusIds() works with a transaction', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;
  const executionRecords = [fakeExecutionRecordFactory(), executionRecord];
  await createRejectableTransaction(knex, async (trx) => {
    const [execution1] = await executionPgModel.create(trx, executionRecords[0]);
    const [execution2] = await executionPgModel.create(trx, executionRecords[1]);
    const executionCumulusId1 = execution1.cumulus_id;
    const executionCumulusId2 = execution2.cumulus_id;

    const results = await executionPgModel
      .searchByCumulusIds(trx, [executionCumulusId1, executionCumulusId2]);
    results.forEach((result, index) => t.like(result, executionRecords[index]));
  });
});

test('ExecutionPgModel.searchByCumulusIds() supports pagination', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;
  const executionRecords = [fakeExecutionRecordFactory(), executionRecord];
  await createRejectableTransaction(knex, async (trx) => {
    const [execution1] = await executionPgModel.create(trx, executionRecords[0]);
    const [execution2] = await executionPgModel.create(trx, executionRecords[1]);
    const executionCumulusId1 = execution1.cumulus_id;
    const executionCumulusId2 = execution2.cumulus_id;

    const firstPage = await executionPgModel
      .searchByCumulusIds(trx, [executionCumulusId1, executionCumulusId2], { limit: 1, offset: 0 });
    const secondPage = await executionPgModel
      .searchByCumulusIds(trx, [executionCumulusId1, executionCumulusId2], { limit: 1, offset: 1 });
    t.is(firstPage.length, 1);
    t.like(firstPage[0], executionRecords[0]);
    t.is(secondPage.length, 1);
    t.like(secondPage[0], executionRecords[1]);
  });
});

test('ExecutionPgModel.searchByCumulusIds() supports sorting', async (t) => {
  const {
    knex,
    executionPgModel,
  } = t.context;
  const executionRecords = [
    fakeExecutionRecordFactory({ status: 'running' }),
    fakeExecutionRecordFactory({ status: 'running' }),
    fakeExecutionRecordFactory({ status: 'failed' }),
    fakeExecutionRecordFactory({ status: 'running' }),
    fakeExecutionRecordFactory({ status: 'completed' }),
  ];

  await createRejectableTransaction(knex, async (trx) => {
    const executionCumulusIds = await Promise.all(executionRecords
      .map(async (executionRecord) => {
        const [pgExecution] = await executionPgModel.create(trx, executionRecord);
        return pgExecution.cumulus_id;
      }));

    const results = await executionPgModel
      .searchByCumulusIds(trx, executionCumulusIds.flat(), { sort_by: 'status', order: 'desc' });

    // first 3 results should have 'running' status
    t.is(results[3].status, 'failed');
    t.is(results[4].status, 'completed');
  });
});

test('ExecutionPgModel.searchExecutionPayloadsBeforeDate() captures all payloaded executions before a date', async (t) => {
  const executionRecords = [
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(3, 'days').toDate(),
      final_payload: null,
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(3, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(3, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(3, 'days').toDate(),
      final_payload: null,
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(4, 'days').toDate(),
      final_payload: null,
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(4, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(4, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(4, 'days').toDate(),
      final_payload: null,
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: null,
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: null,
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(6, 'days').toDate(),
      final_payload: null,
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(6, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(6, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(6, 'days').toDate(),
      final_payload: null,
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(7, 'days').toDate(),
      final_payload: null,
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(7, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(7, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(7, 'days').toDate(),
      final_payload: null,
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(8, 'days').toDate(),
      final_payload: null,
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(8, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: { a: 'b' },
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(8, 'days').toDate(),
      final_payload: { a: 'b' },
      original_payload: null,
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(8, 'days').toDate(),
      final_payload: null,
      original_payload: { a: 'b' },
    }),
  ];
  const targetTime = moment().subtract(5, 'days').toDate();
  const model = new ExecutionPgModel();
  await model.insert(t.context.knex, executionRecords);
  const payloadsBeforeDate = await model.searchExecutionPayloadsBeforeDate(
    t.context.knex, targetTime
  );
  t.is(payloadsBeforeDate.length, 12);
  payloadsBeforeDate.forEach(
    (execution) => {
      t.true(execution.updated_at < targetTime);
      t.true(Boolean(execution.final_payload) || Boolean(execution.original_payload));
    }
  );
});
