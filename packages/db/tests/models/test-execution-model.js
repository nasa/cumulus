const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

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
  upsertGranuleWithExecutionJoinRecord,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration');
const { randomId } = require('../../../es-client/node_modules/@cumulus/common/test-utils');

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

test('ExecutionPgModel.upsert() creates new running execution', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'running';

  await executionPgModel.upsert(knex, executionRecord);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    executionRecord
  );
});

test('ExecutionPgModel.upsert() updates only allowed fields for a running execution', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'running';
  executionRecord.workflow_name = 'workflow-1';
  executionRecord.url = 'url-1';
  await executionPgModel.create(knex, executionRecord);

  const updatedRecord = {
    ...executionRecord,
    created_at: new Date(),
    updated_at: new Date(),
    timestamp: new Date(),
    original_payload: {
      foo: 'bar',
    },
    workflow_name: 'workflow-2',
    url: 'url-2',
  };

  await executionPgModel.upsert(knex, updatedRecord);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    {
      ...updatedRecord,
      workflow_name: 'workflow-1',
      url: 'url-1',
    }
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
  executionRecord.final_payload = {
    key1: 'value',
  };
  await executionPgModel.create(knex, executionRecord);

  const updatedRecord = {
    ...executionRecord,
    final_payload: {
      key2: 'value',
    },
  };
  await executionPgModel.upsert(knex, updatedRecord);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    updatedRecord
  );
});

test('ExecutionPgModel.upsert() will not allow a running execution to replace a completed execution', async (t) => {
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

test('ExecutionPgModel.delete() deletes execution and granule/execution join records', async (t) => {
  const {
    knex,
    collectionPgModel,
    granulesExecutionsPgModel,
    executionPgModel,
    granulePgModel,
    executionRecord,
  } = t.context;

  const [collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );

  const [granuleCumulusId] = await granulePgModel.create(knex, fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  }));

  const [executionCumulusId] = await knex.transaction(async (trx) => {
    const executionCreateResponse = await executionPgModel.create(trx, executionRecord);
    await granulesExecutionsPgModel.create(trx, {
      execution_cumulus_id: executionCreateResponse[0],
      granule_cumulus_id: granuleCumulusId,
    });
    return executionCreateResponse;
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

  await knex.transaction(
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
  const executionRecords = [executionRecord, fakeExecutionRecordFactory()];
  let executionCumulusId1;
  let executionCumulusId2;
  await knex.transaction(async (trx) => {
    [executionCumulusId1] = await executionPgModel.create(trx, executionRecords[0]);
    [executionCumulusId2] = await executionPgModel.create(trx, executionRecords[1]);
  });

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
  const executionRecords = [executionRecord, fakeExecutionRecordFactory()];
  await knex.transaction(async (trx) => {
    const [executionCumulusId1] = await executionPgModel.create(trx, executionRecords[0]);
    const [executionCumulusId2] = await executionPgModel.create(trx, executionRecords[1]);

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
  const executionRecords = [executionRecord, fakeExecutionRecordFactory()];
  await knex.transaction(async (trx) => {
    const [executionCumulusId1] = await executionPgModel.create(trx, executionRecords[0]);
    const [executionCumulusId2] = await executionPgModel.create(trx, executionRecords[1]);

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


test('ExecutionsPgModel.getWorkflowNameJoin() returns correct values', async (t) => {
  const {
    knex,
    collectionPgModel,
    executionPgModel,
    granulesExecutionsPgModel,
  } = t.context;
  const [collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );
  const granuleRecords = [
    fakeGranuleRecordFactory({ granule_id: randomId('granule1'), collection_cumulus_id: collectionCumulusId }),
    fakeGranuleRecordFactory({ granule_id: randomId('granule2'), collection_cumulus_id: collectionCumulusId }),
    fakeGranuleRecordFactory({ granule_id: randomId('granule3'), collection_cumulus_id: collectionCumulusId }),
  ];
  const executionRecords = [
    fakeExecutionRecordFactory({ workflow_name: 'fakeWorkflow' }),
    fakeExecutionRecordFactory({ workflow_name: 'fakeWorkflow' }),
    fakeExecutionRecordFactory({ workflow_name: 'fakeWorkflow2' }),
  ];
  let executionCumulusId1;
  let executionCumulusId2;
  let executionCumulusId3;
  await knex.transaction(async (trx) => {
    [executionCumulusId1] = await executionPgModel.create(trx, executionRecords[0]);
    [executionCumulusId2] = await executionPgModel.create(trx, executionRecords[1]);
    [executionCumulusId3] = await executionPgModel.create(trx, executionRecords[2]);
  });

  // granule 1 is associated with execution 1 + 3
  const [granuleCumulusId1] = await upsertGranuleWithExecutionJoinRecord(knex,
    granuleRecords[0],
    executionCumulusId1);

  await granulesExecutionsPgModel.create(knex, {
    granule_cumulus_id: granuleCumulusId1,
    execution_cumulus_id: executionCumulusId3,
  });

  // granule 2 is associated with execution 2
  const [granuleCumulusId2] = await upsertGranuleWithExecutionJoinRecord(knex,
    granuleRecords[1],
    executionCumulusId2);

  // granule 3 is associated with executions 2 + 3
  const [granuleCumulusId3] = await upsertGranuleWithExecutionJoinRecord(knex,
    granuleRecords[2],
    executionCumulusId1);

  await granulesExecutionsPgModel.create(knex, {
    granule_cumulus_id: granuleCumulusId3,
    execution_cumulus_id: executionCumulusId3,
  });


  const results = await executionPgModel
    .getWorkflowNameJoin(knex, [granuleCumulusId1, granuleCumulusId2, granuleCumulusId3]);

  t.deepEqual(results, ['fakeWorkflow']);
});

test('ExecutionsPgModel.getWorkflowNameJoin() returns correct values for single granule', async (t) => {
  const {
    knex,
    collectionPgModel,
    executionPgModel,
    granulesExecutionsPgModel,
  } = t.context;

  const [collectionCumulusId] = await collectionPgModel.create(knex, fakeCollectionRecordFactory());
  const granuleRecord = fakeGranuleRecordFactory({
    granule_id: randomId('granule1'),
    collection_cumulus_id: collectionCumulusId,
  });
  const executionRecords = [
    fakeExecutionRecordFactory({ workflow_name: 'fakeWorkflow' }),
    fakeExecutionRecordFactory({ workflow_name: 'fakeWorkflow' }),
    fakeExecutionRecordFactory({ workflow_name: 'fakeWorkflow2' }),
  ];

  let executionCumulusId1;
  let executionCumulusId2;
  let executionCumulusId3;
  await knex.transaction(async (trx) => {
    [executionCumulusId1] = await executionPgModel.create(trx, executionRecords[0]);
    [executionCumulusId2] = await executionPgModel.create(trx, executionRecords[1]);
    [executionCumulusId3] = await executionPgModel.create(trx, executionRecords[2]);
  });

  const [granuleCumulusId] = await upsertGranuleWithExecutionJoinRecord(knex,
    granuleRecord,
    executionCumulusId1);

  await granulesExecutionsPgModel.create(knex, {
    granule_cumulus_id: granuleCumulusId,
    execution_cumulus_id: executionCumulusId2,
  });

  await granulesExecutionsPgModel.create(knex, {
    granule_cumulus_id: granuleCumulusId,
    execution_cumulus_id: executionCumulusId3,
  });

  const results = await executionPgModel
    .getWorkflowNameJoin(knex, [granuleCumulusId]);

  t.deepEqual(results.sort(), ['fakeWorkflow', 'fakeWorkflow2']);
});
