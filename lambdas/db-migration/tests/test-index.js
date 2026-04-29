const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { handler } = require('../dist/webpack');

test.before(async (t) => {
  // Master connection used to manage dynamic test databases
  t.context.masterKnex = await getKnexClient({ env: localStackConnectionEnv });
});

test.beforeEach(async (t) => {
  const testDbName = `db_${cryptoRandomString({ length: 10 })}`;

  await t.context.masterKnex.raw(`CREATE DATABASE ${testDbName}`);

  t.context.testDbName = testDbName;
  t.context.testEnv = {
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };
});

test.afterEach.always(async (t) => {
  if (t.context.testKnex) {
    await t.context.testKnex.destroy();
  }

  await t.context.masterKnex.raw(`DROP DATABASE IF EXISTS ${t.context.testDbName}`);
});

test.after.always(async (t) => {
  await t.context.masterKnex.destroy();
});

test.serial('handler runs standard migrations on a fresh database', async (t) => {
  const { testEnv } = t.context;

  await handler({ command: 'latest', env: testEnv });

  t.context.testKnex = await getKnexClient({ env: testEnv });

  const hasExecutions = await t.context.testKnex.schema.hasTable('executions');
  t.true(hasExecutions, 'The executions table should exist after migration');

  // Verify that the current year's Q1 partition exists
  const currentYear = new Date().getFullYear();
  const partitionName = `public.executions_${currentYear}_q1`;
  const partitionResult = await t.context.testKnex.raw(`
    SELECT to_regclass(?) as exists
  `, [partitionName]);

  t.truthy(
    partitionResult.rows[0].exists,
    `The partition ${partitionName} should exist for the current year`
  );
});

test.serial('handler triggers bootstrap when USE_BOOTSTRAP is "true" and DB is empty', async (t) => {
  const bootstrapEnv = {
    ...t.context.testEnv,
    USE_BOOTSTRAP: 'true',
  };

  await handler({ command: 'latest', env: bootstrapEnv });

  t.context.testKnex = await getKnexClient({ env: bootstrapEnv });

  const hasCollections = await t.context.testKnex.schema.hasTable('collections');
  t.true(hasCollections, 'The collections table should be created via migrations-bootstrap');
});

test.serial('handler rolls back migrations correctly', async (t) => {
  const { testEnv } = t.context;

  await handler({ command: 'latest', env: testEnv });

  await handler({ command: 'rollback', env: testEnv });

  t.context.testKnex = await getKnexClient({ env: testEnv });

  // After full rollback, the migrations table should be empty (or core tables gone)
  const hasExecutions = await t.context.testKnex.schema.hasTable('executions');
  t.false(hasExecutions, 'The executions table should be removed after rollback');
});

test.serial('handler rolls back migrations correctly when USE_BOOTSTRAP is "true"', async (t) => {
  const bootstrapEnv = {
    ...t.context.testEnv,
    USE_BOOTSTRAP: 'true',
  };

  await handler({ command: 'latest', env: bootstrapEnv });

  await handler({ command: 'rollback', env: bootstrapEnv });

  t.context.testKnex = await getKnexClient({ env: bootstrapEnv });

  // After full rollback, the migrations table should be empty (or core tables gone)
  const hasExecutions = await t.context.testKnex.schema.hasTable('executions');
  t.false(hasExecutions, 'The executions table should be removed after rollback');
});
