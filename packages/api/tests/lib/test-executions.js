const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  localStackConnectionEnv,
  destroyLocalTestDb,
  generateLocalTestDb,
  migrationDir,
  ExecutionSearch,
} = require('@cumulus/db');

const { createExecutionRecords } = require('../helpers/create-test-data');

const { chooseTargetExecution, batchDeleteExecutions } = require('../../lib/executions');

const randomArn = () => `arn_${cryptoRandomString({ length: 10 })}`;
const randomGranuleId = () => `granuleId_${cryptoRandomString({ length: 10 })}`;
const randomWorkflow = () => `workflow_${cryptoRandomString({ length: 10 })}`;

process.env.PG_HOST = `hostname_${cryptoRandomString({ length: 10 })}`;
process.env.PG_USER = `user_${cryptoRandomString({ length: 10 })}`;
process.env.PG_PASSWORD = `password_${cryptoRandomString({ length: 10 })}`;
process.env.PG_DATABASE = `password_${cryptoRandomString({ length: 10 })}`;

test.beforeEach(async (t) => {
  try {
    const testDbName = `test_executions_${cryptoRandomString({ length: 10 })}`;
    process.env = { ...process.env, ...localStackConnectionEnv, PG_DATABASE: testDbName };
    const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
    t.context = {
      ...t.context,
      knex,
      knexAdmin,
      testDbName,
    };
  } catch (error) {
    console.log(error);
    throw error;
  }
});

test.afterEach.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName: t.context.testDbName,
  });
});

const searchAllExecutionsForCollection = async (collectionId) => {
  const searchClient = new ExecutionSearch(
    {
      queryStringParameters: {
        collectionId,
      },
    }
  );
  const response = await searchClient.query();
  return response;
};

test('chooseTargetExecution() returns executionArn if provided.', async (t) => {
  const executionArn = randomArn();
  const granuleId = randomGranuleId();
  const expected = executionArn;

  const actual = await chooseTargetExecution({ granuleId, executionArn });

  t.is(expected, actual);
});

test('chooseTargetExecution() returns undefined if no executionarn nor workflowName are provided.', async (t) => {
  const granuleId = randomGranuleId();
  const expected = undefined;

  const actual = await chooseTargetExecution({ granuleId });

  t.is(expected, actual);
});

test('chooseTargetExecution() returns the arn found in the database when a workflowName is provided.', async (t) => {
  const workflowName = randomWorkflow();
  const granuleId = randomGranuleId();
  const arn = randomArn();
  const testDbFunction = () => Promise.resolve(arn);

  const actual = await chooseTargetExecution({
    granuleId,
    workflowName,
    dbFunction: testDbFunction,
  });

  t.is(actual[0].arn, t.context.arn);
});

test('chooseTargetExecution() throws exactly any error raised in the database function.', async (t) => {
  const workflowName = randomWorkflow();
  const granuleId = randomGranuleId();
  const anError = new Error('a different Error');
  const testDbFunction = () => {
    throw anError;
  };

  await t.throwsAsync(
    chooseTargetExecution({
      granuleId,
      workflowName,
      dbFunction: testDbFunction,
    }),
    {
      instanceOf: Error,
      message: anError.message,
    }
  );
});

test.serial('batchDeleteExecutions() deletes expected executions from the database.', async (t) => {
  const collectionId = 'originalCollection___001';
  const executionCount = 57;
  const otherCollectionId = 'otherCollectionId___001';
  const otherExecutionCount = 10;

  const { pgCollectionRecord } = await createExecutionRecords({
    knex: t.context.knex,
    count: executionCount,
    collectionId,
    addParentExecutions: true,
  });

  const otherCollectionRecords = await createExecutionRecords({
    knex: t.context.knex,
    count: otherExecutionCount,
    collectionId: otherCollectionId,
    addParentExecutions: true,
  });

  const setupExecutions = await searchAllExecutionsForCollection(
    collectionId
  );

  const otherCollectionEsExecutions = await searchAllExecutionsForCollection(
    otherCollectionId
  );

  const setupRdsExecutions = await t.context.knex('executions').select();

  t.is(setupRdsExecutions.length, executionCount + otherExecutionCount + 2);
  t.is(setupExecutions.meta.count + otherCollectionEsExecutions.meta.count,
    executionCount + otherExecutionCount + 2);

  await batchDeleteExecutions({
    collectionId,
    batchSize: 7,
  });
  const postDeleteEsExecutions = await searchAllExecutionsForCollection(
    collectionId
  );
  const postDeleteRdsExecutions = await t.context.knex('executions').where('collection_cumulus_id', pgCollectionRecord[0].cumulus_id);
  t.is(postDeleteRdsExecutions.length, 0);
  t.is(postDeleteEsExecutions.meta.count, 0);

  // Validate original executions exist
  const otherEsExecutions = await searchAllExecutionsForCollection(
    otherCollectionId
  );
  const otherRdsExecutions = await t.context.knex('executions').where('collection_cumulus_id', otherCollectionRecords.pgCollectionRecord[0].cumulus_id);
  t.is(otherEsExecutions.meta.count, otherExecutionCount + 1);
  t.is(otherRdsExecutions.length, otherExecutionCount + 1);
});
