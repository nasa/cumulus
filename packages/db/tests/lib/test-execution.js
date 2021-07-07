const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const testDbName = `execution_${cryptoRandomString({ length: 10 })}`;
const randomArn = () => `arn_${cryptoRandomString({ length: 10 })}`;
const randomGranuleId = () => `granuleId_${cryptoRandomString({ length: 10 })}`;
const randomWorkflow = () => `workflow_${cryptoRandomString({ length: 10 })}`;

const { migrationDir } = require('../../../../lambdas/db-migration');
const {
  destroyLocalTestDb,
  generateLocalTestDb,
  GranulePgModel,
  GranulesExecutionsPgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  ExecutionPgModel,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  executionArnsFromGranuleIdsAndWorkflowNames,
} = require('../../dist');

const linkNewExecutionToGranule = async (
  t,
  granuleCumulusId,
  executionParams
) => {
  const [executionCumulusId] = await t.context.executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory(executionParams)
  );
  const joinRecord = {
    execution_cumulus_id: executionCumulusId,
    granule_cumulus_id: granuleCumulusId,
  };
  await t.context.granulesExecutionsPgModel.create(t.context.knex, joinRecord);
  return executionCumulusId;
};

const newGranuleAssociatedWithExecution = async (
  t,
  executionParams,
  granuleParams
) => {
  const [granuleCumulusId] = await t.context.granulePgModel.create(
    t.context.knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: t.context.collectionCumulusId,
      ...granuleParams,
    })
  );
  const executionCumulusId = await linkNewExecutionToGranule(
    t,
    granuleCumulusId,
    executionParams
  );
  return { executionCumulusId, granuleCumulusId };
};

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();

  const collectionPgModel = new CollectionPgModel();
  [t.context.collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );

  t.context.executionPgModel = new ExecutionPgModel();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('executionArnsFromGranuleIdsAndWorkflowNames() returns arn by workflow and granuleId for linked granule execution.', async (t) => {
  const workflowName = randomWorkflow();
  const executionArn = randomArn();
  const granuleId = randomGranuleId();

  await newGranuleAssociatedWithExecution(
    t,
    {
      workflow_name: workflowName,
      arn: executionArn,
    },
    {
      granule_id: granuleId,
    }
  );

  const results = await executionArnsFromGranuleIdsAndWorkflowNames(
    t.context.knex,
    [granuleId],
    [workflowName]
  );

  t.is(results[0].arn, executionArn);
});
