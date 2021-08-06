const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
  GranulesExecutionsPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  getExecutionsByGranuleCumulusId,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration/dist/lambda');

const testDbName = `granule_lib_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();

  const collectionPgModel = new CollectionPgModel();
  t.context.collection = fakeCollectionRecordFactory();
  const collectionResponse = await collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = collectionResponse[0];
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('getExecutionsByGranule() gets all Executions related to a Granule', async (t) => {
  const {
    knex,
    collectionCumulusId,
    executionPgModel,
    granulePgModel,
    granulesExecutionsPgModel,
  } = t.context;

  // Create executions
  const [executionACumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );
  const [executionBCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );

  // Create Granule
  const [granuleCumulusId] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
    })
  );
  // Create GranulesExecuions JOIN records
  await granulesExecutionsPgModel.create(
    knex,
    {
      granule_cumulus_id: granuleCumulusId,
      execution_cumulus_id: executionACumulusId,
    }
  );
  await granulesExecutionsPgModel.create(
    knex,
    {
      granule_cumulus_id: granuleCumulusId,
      execution_cumulus_id: executionBCumulusId,
    }
  );

  const exepectedExecutions = [
    await executionPgModel.get(knex, { cumulus_id: executionACumulusId }),
    await executionPgModel.get(knex, { cumulus_id: executionBCumulusId }),
  ];

  const result = await getExecutionsByGranuleCumulusId(
    knex,
    granuleCumulusId
  );

  t.deepEqual(
    result.sort(),
    exepectedExecutions.sort()
  );
});
