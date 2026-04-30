const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { handler } = require('../dist/lambda');

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

  const tables = ['executions', 'granules', 'collections'];

  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await t.context.testKnex.schema.hasTable(table);
    t.false(exists, `${table} should be removed after rollback`);
  }

  const migrations = await t.context.testKnex('knex_migrations');
  t.is(migrations.length, 0, 'No migrations should remain after rollback');
});

test.serial('handler rolls back migrations correctly when USE_BOOTSTRAP is "true"', async (t) => {
  const bootstrapEnv = {
    ...t.context.testEnv,
    USE_BOOTSTRAP: 'true',
  };

  await handler({ command: 'latest', env: bootstrapEnv });

  await handler({ command: 'rollback', env: bootstrapEnv });

  t.context.testKnex = await getKnexClient({ env: bootstrapEnv });

  const tables = ['executions', 'granules', 'collections'];
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await t.context.testKnex.schema.hasTable(table);
    t.false(exists, `${table} should be removed after rollback`);
  }

  const migrations = await t.context.testKnex('knex_migrations');
  t.is(migrations.length, 0, 'No migrations should remain after rollback');
});

test.serial('handler throws an error when an invalid command is provided', async (t) => {
  const { testEnv } = t.context;

  // Passing a command that is not 'latest' or 'rollback'
  const invalidCommand = 'bad-command';

  const error = await t.throwsAsync(
    handler({ command: invalidCommand, env: testEnv }),
    { instanceOf: Error }
  );

  t.is(error.message, `Invalid command: ${invalidCommand}`, 'The error message should match the expected format');
});

test.serial('handler can apply standard patches to a database previously created via bootstrap', async (t) => {
  const { testEnv } = t.context;

  // Initialize the database using Bootstrap
  const bootstrapEnv = {
    ...testEnv,
    USE_BOOTSTRAP: 'true',
  };
  await handler({ command: 'latest', env: bootstrapEnv });

  t.context.testKnex = await getKnexClient({ env: testEnv });
  const hasCollections = await t.context.testKnex.schema.hasTable('collections');
  t.true(hasCollections, 'Database should be initialized via bootstrap');

  // Run standard migrations
  await handler({ command: 'latest', env: testEnv });

  // Verify standard migrations were applied
  const hasExecutions = await t.context.testKnex.schema.hasTable('executions');
  t.true(hasExecutions, 'The executions table should still exist/be valid after standard migrations run');

  // Check the migrations table to ensure Knex is tracking the state
  const migrations = await t.context.testKnex('knex_migrations').select('*');
  t.truthy(migrations.length > 0, 'The migrations table should contain entries from the patch-based files');
});
