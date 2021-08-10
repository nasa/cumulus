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
  getExecutionArnsByGranuleCumulusId,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration/dist/lambda');

const testDbName = `execution_${cryptoRandomString({ length: 10 })}`;

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

test('getExecutionArnsByGranuleCumulusId() gets all Executions related to a Granule', async (t) => {
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
    fakeExecutionRecordFactory({ timestamp: new Date(Date.now()) })
  );
  const [executionBCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory({ timestamp: new Date(Date.now() - 200 * 1000) })
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

  const exepectedExecutionArn1 = await executionPgModel.get(
    knex,
    { cumulus_id: executionACumulusId }
  );
  const exepectedExecutionArn2 = await executionPgModel.get(
    knex,
    { cumulus_id: executionBCumulusId }
  );

  const result = await getExecutionArnsByGranuleCumulusId(
    knex,
    granuleCumulusId
  );

  t.deepEqual(
    result,
    [{ arn: exepectedExecutionArn1.arn }, { arn: exepectedExecutionArn2.arn }]
  );
});
