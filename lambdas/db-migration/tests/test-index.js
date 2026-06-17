const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { promisify } = require('util');
const execFileAsync = promisify(require('child_process').execFile);
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { handler } = require('../dist/lambda');

const normalizeDump = (schema) =>
  schema
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .filter((line) => !line.startsWith('SET '))
    .filter((line) => !line.includes('pg_catalog.'))
    .filter((line) => !line.startsWith('\\restrict'))
    .filter((line) => !line.startsWith('\\unrestrict'))
    .filter((line) => !line.includes('knex_migrations'))
    .filter((line) => !line.includes('knex_migrations_lock'))
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

const dumpSchema = async (env) => {
  const { stdout } = await execFileAsync(
    'pg_dump',
    [
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '--host', env.PG_HOST,
      '--port', env.PG_PORT,
      '--username', env.PG_USER,
      env.PG_DATABASE,
    ],
    {
      env: {
        ...process.env,
        PGPASSWORD: env.PG_PASSWORD,
      },
    }
  );

  return normalizeDump(stdout);
};

// Helper to fetch active partition tables from PostgreSQL catalog
const getPartitionNames = async (tableName, knexClient) => {
  const result = await knexClient
    .select('child.relname as name')
    .from('pg_inherits')
    .join('pg_class as parent', 'pg_inherits.inhparent', 'parent.oid')
    .join('pg_class as child', 'pg_inherits.inhrelid', 'child.oid')
    .where('parent.relname', tableName);
  return result.map((p) => p.name);
};

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

test.serial('handler creates correct granules and files partitions based on env', async (t) => {
  const { testEnv } = t.context;

  // Set environment variables for this test
  process.env.GRANULES_PARTITION_COUNT = '16';
  process.env.FILES_PARTITION_COUNT = '32';

  try {
    await handler({ command: 'latest', env: testEnv });

    t.context.testKnex = await getKnexClient({ env: testEnv });

    const granulePartitions = await getPartitionNames('granules', t.context.testKnex);

    t.is(
      granulePartitions.length,
      Number(process.env.GRANULES_PARTITION_COUNT),
      `Should have ${process.env.GRANULES_PARTITION_COUNT} granule partitions`
    );

    const filePartitions = await getPartitionNames('files', t.context.testKnex);

    t.is(
      filePartitions.length,
      Number(process.env.FILES_PARTITION_COUNT),
      `Should have ${process.env.FILES_PARTITION_COUNT} file partitions`
    );
  } finally {
    delete process.env.GRANULES_PARTITION_COUNT;
    delete process.env.FILES_PARTITION_COUNT;
  }
});

test.serial('bootstrap schema matches standard migration schema', async (t) => {
  const { testEnv } = t.context;
  const standardDb = `std_${cryptoRandomString({ length: 8 })}`;
  const bootstrapDb = `boot_${cryptoRandomString({ length: 8 })}`;

  await t.context.masterKnex.raw(`CREATE DATABASE ${standardDb}`);
  await t.context.masterKnex.raw(`CREATE DATABASE ${bootstrapDb}`);

  const standardEnv = {
    ...testEnv,
    PG_DATABASE: standardDb,
  };

  const bootstrapEnv = {
    ...testEnv,
    PG_DATABASE: bootstrapDb,
    USE_BOOTSTRAP: 'true',
  };

  try {
    await handler({ command: 'latest', env: standardEnv });
    await handler({ command: 'latest', env: bootstrapEnv });

    const standardSchema = await dumpSchema(standardEnv);
    const bootstrapSchema = await dumpSchema(bootstrapEnv);

    const standardLines = standardSchema.split('\n');
    const bootstrapLines = bootstrapSchema.split('\n');

    const onlyInStandard = standardLines.filter(
      (line) => !bootstrapLines.includes(line)
    );

    const onlyInBootstrap = bootstrapLines.filter(
      (line) => !standardLines.includes(line)
    );

    if (onlyInStandard.length > 0 || onlyInBootstrap.length > 0) {
      console.log('Only in standard schema:\n', onlyInStandard.join('\n'));
      console.log('Only in bootstrap schema:\n', onlyInBootstrap.join('\n'));

      t.fail('Bootstrap schema does not match standard schema');
    }

    t.pass();
  } finally {
    await t.context.masterKnex.raw(`DROP DATABASE IF EXISTS ${standardDb}`);
    await t.context.masterKnex.raw(`DROP DATABASE IF EXISTS ${bootstrapDb}`);
  }
});

test.serial('execution partitions are provisioned incrementally on subsequent runs', async (t) => {
  const { testEnv } = t.context;
  const currentYear = new Date().getFullYear();

  // Initial Run: Provision 2 years ahead
  await handler({ command: 'latest', env: { ...testEnv, EXECUTIONS_PARTITION_TOTAL_YEARS: '2' } });
  t.context.testKnex = await getKnexClient({ env: testEnv });

  let provisioned = await getPartitionNames('executions', t.context.testKnex);
  t.true(provisioned.includes(`executions_${currentYear}_q1`), 'Current year partitions should exist');
  t.true(provisioned.includes(`executions_${currentYear + 1}_q4`), 'Next year partitions should exist');
  t.false(provisioned.includes(`executions_${currentYear + 2}_q1`), 'Year +2 partitions should not exist yet');

  // Incremental Run: Expand to 4 years ahead
  await t.context.testKnex.destroy(); // clear connections
  await handler({ command: 'latest', env: { ...testEnv, EXECUTIONS_PARTITION_TOTAL_YEARS: '4' } });
  t.context.testKnex = await getKnexClient({ env: testEnv });

  // Final Validation: Verify all 4 years of partitions exist cleanly
  provisioned = await getPartitionNames('executions', t.context.testKnex);
  for (let year = currentYear; year < currentYear + 4; year += 1) {
    for (let q = 1; q <= 4; q += 1) {
      t.true(provisioned.includes(`executions_${year}_q${q}`), `executions_${year}_q${q} missing`);
    }
  }
});

test.serial('expired execution partitions are purged while explicitly keeping unexpired rows intact', async (t) => {
  const { testEnv } = t.context;

  // Initialize database schema
  await handler({ command: 'latest', env: testEnv });
  t.context.testKnex = await getKnexClient({ env: testEnv });
  const knex = t.context.testKnex;

  const currentYear = new Date().getFullYear();
  const defaultPartitionName = 'executions_default';

  // Define a mix of expired partitions and one explicit UNEXPIRED partition
  const partitionsToSeed = [
    { name: 'executions_custom_old_data', start: `${currentYear - 5}-05-01`, end: `${currentYear - 5}-06-01`, arn: 'arn:aws:states:us-east-1:123456789012:execution:expired-5years', isExpired: true },
    { name: `executions_${currentYear - 4}_q1`, start: `${currentYear - 4}-01-01`, end: `${currentYear - 4}-04-01`, arn: 'arn:aws:states:us-east-1:123456789012:execution:expired-4years', isExpired: true },
    { name: `executions_${currentYear - 3}_q2`, start: `${currentYear - 3}-04-01`, end: `${currentYear - 3}-07-01`, arn: 'arn:aws:states:us-east-1:123456789012:execution:expired-3years', isExpired: true },
    { name: `executions_${currentYear - 1}_q3`, start: `${currentYear - 1}-07-01`, end: `${currentYear - 1}-10-01`, arn: 'arn:aws:states:us-east-1:123456789012:execution:keep-1year-old', isExpired: false },
  ];

  // Concurrently create tables and insert matching data
  const BATCH_SEED_SIZE = 25000;
  await Promise.all(
    partitionsToSeed.map(async (part) => {
      await knex.raw(`
        CREATE TABLE IF NOT EXISTS public.${part.name} PARTITION OF executions
        FOR VALUES FROM ('${part.start}') TO ('${part.end}');
      `);

      if (part.isExpired) {
        await knex.raw(`
          INSERT INTO executions (arn, url, created_at, status)
          SELECT
            '${part.arn}-' || s.seq,
            'https://example.com${part.name}/' || s.seq,
            '${part.start}'::TIMESTAMP,
            'failed'
          FROM generate_series(1, ${BATCH_SEED_SIZE}) AS s(seq);
        `);
      } else {
        await knex('executions').insert({
          arn: part.arn,
          url: `https://example.com${part.name}`,
          created_at: part.start,
          status: 'failed',
        });
      }
    })
  );

  // BEFORE CHECK: Verify all guard records exist before running cleaner
  const totalExpiredPartitions = partitionsToSeed.filter((p) => p.isExpired).length;
  const expectedTotalExpiredRows = totalExpiredPartitions * BATCH_SEED_SIZE;
  const expectedTotalRows = expectedTotalExpiredRows + 1; // plus 1 for the unexpired row

  const [[totalUniqueRowsBefore], [totalExecutionsBefore]] = await Promise.all([
    knex('executions_global_unique').count('arn as count'),
    knex('executions').count('cumulus_id as count'),
  ]);

  t.is(Number(totalUniqueRowsBefore.count), expectedTotalRows, 'All 75,001 unique tracking guard keys must exist initially');
  t.is(Number(totalExecutionsBefore.count), expectedTotalRows, 'All 75,001 base executions records must exist initially');

  // Run handler again with specific retention environment overrides to invoke the procedure
  const activeRetentionEnv = {
    ...testEnv,
    EXECUTIONS_PARTITION_TOTAL_YEARS: '2',
    EXECUTIONS_PARTITION_RETENTION_YEARS: '2',
  };
  await handler({ command: 'latest', env: activeRetentionEnv });

  // Concurrently verify partition existence states
  await Promise.all(
    partitionsToSeed.map(async (part) => {
      const tableCheck = await knex.raw(`
        SELECT to_regclass(?) as exists
      `, [`public.${part.name}`]);

      if (part.isExpired) {
        t.falsy(tableCheck.rows[0].exists, `Expired partition ${part.name} should be dropped`);
      } else {
        t.truthy(tableCheck.rows[0].exists, `Unexpired partition ${part.name} must remain intact`);
      }
    })
  );

  const defaultCheck = await knex.raw(`
    SELECT to_regclass(?) as exists
  `, [`public.${defaultPartitionName}`]);
  t.truthy(defaultCheck.rows[0].exists, 'The default fallback partition table layout must remain completely untouched');

  // AFTER CHECK: Verify arns are removed from global unique table for expired records
  const [remainingExpiredUnique, keepArns] = await Promise.all([
    knex('executions_global_unique').whereLike('arn', '%:expired-%'),
    partitionsToSeed.filter((p) => !p.isExpired).map((p) => p.arn),
  ]);

  t.is(remainingExpiredUnique.length, 0, 'All 75,000 expired keys must be cleanly removed from executions_global_unique');

  // Unexpired ARNs must still be present
  const remainingKeepRows = await knex('executions_global_unique').whereIn('arn', keepArns);
  t.is(remainingKeepRows.length, keepArns.length, 'Unexpired guard keys must still remain inside executions_global_unique');
});

test.serial('execution partition deletion is disabled by default when retention years is omitted', async (t) => {
  const { testEnv } = t.context;

  // Configure env with retention completely omitted to ensure baseline null behavior triggers
  const baselineEnv = {
    ...testEnv,
    EXECUTIONS_PARTITION_TOTAL_YEARS: '1',
  };
  delete baselineEnv.EXECUTIONS_PARTITION_RETENTION_YEARS;

  await handler({ command: 'latest', env: baselineEnv });
  t.context.testKnex = await getKnexClient({ env: baselineEnv });
  const knex = t.context.testKnex;

  const currentYear = new Date().getFullYear();
  const oldPartitionName = `executions_${currentYear - 5}_q3`;

  // Seed historical partition
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS public.${oldPartitionName} PARTITION OF executions
    FOR VALUES FROM ('${currentYear - 5}-07-01') TO ('${currentYear - 5}-10-01');
  `);

  // Run migrations again, executing the procedure under baseline default variables
  await handler({ command: 'latest', env: baselineEnv });

  // Verify the old partition was NOT dropped because retention defaulted to null
  const tableCheck = await knex.raw(`
    SELECT to_regclass(?) as exists
  `, [`public.${oldPartitionName}`]);

  t.truthy(tableCheck.rows[0].exists, 'The old partition must be preserved when retention defaults to null baseline');
});
