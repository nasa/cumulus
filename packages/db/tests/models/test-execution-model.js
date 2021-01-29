const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  ExecutionPgModel,
  fakeExecutionRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `execution_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.executionPgModel = new ExecutionPgModel();
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
