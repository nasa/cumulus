'use strict';

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  migrationDir,
} = require('@cumulus/db');

/**
 * Partition counts that match a normally-deployed stack.
 *
 * These are the Terraform defaults from `tf-modules/data-persistence/variables.tf`
 * (`db_partition_config`), not the migration-code fallbacks of 8/8/2/4. A test database
 * built with the code fallbacks would route rows over 8 granule partitions instead of 64
 * and would not represent any real deployment.
 */
const DEPLOYED_PARTITION_COUNTS = Object.freeze({
  GRANULES_PARTITION_COUNT: '64',
  FILES_PARTITION_COUNT: '256',
  GRANULES_GLOBAL_UNIQUE_PARTITION_COUNT: '16',
  FILES_GLOBAL_UNIQUE_PARTITION_COUNT: '64',
});

/**
 * Small counts, for tests that do not care about partition routing. 256 file partitions
 * makes every migration noticeably slower, so only ask for the deployed counts when the
 * test is actually about them.
 */
const SMALL_PARTITION_COUNTS = Object.freeze({
  GRANULES_PARTITION_COUNT: '2',
  FILES_PARTITION_COUNT: '2',
  GRANULES_GLOBAL_UNIQUE_PARTITION_COUNT: '2',
  FILES_GLOBAL_UNIQUE_PARTITION_COUNT: '2',
});

/**
 * Create a migrated test database with explicit partition counts.
 *
 * `getPartitionCount` in packages/db/src/lib/migration.ts reads `process.env` directly at
 * migration time and ignores the `envParams` handed to `generateLocalTestDb`, so the
 * counts must be on `process.env` *before* the migrations run. Callers must therefore use
 * `test.serial` for anything relying on a specific count.
 *
 * @param {object} params
 * @param {string} params.testDbName
 * @param {Record<string, string>} [params.partitionCounts]
 * @returns {Promise<{knex: import('knex').Knex, knexAdmin: import('knex').Knex,
 *   testDbName: string}>}
 */
const createSeedTestDb = async ({
  testDbName,
  partitionCounts = SMALL_PARTITION_COUNTS,
}) => {
  const saved = {};
  Object.keys(partitionCounts).forEach((key) => {
    saved[key] = process.env[key];
    process.env[key] = partitionCounts[key];
  });

  try {
    const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir, {});
    return { knex, knexAdmin, testDbName };
  } finally {
    Object.keys(saved).forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  }
};

/**
 * @param {object} params
 * @param {import('knex').Knex} params.knex
 * @param {import('knex').Knex} params.knexAdmin
 * @param {string} params.testDbName
 * @returns {Promise<void>}
 */
const teardownSeedTestDb = ({ knex, knexAdmin, testDbName }) =>
  destroyLocalTestDb({ knex, knexAdmin, testDbName });

/**
 * Count attached partitions of a table. Used to prove a fixture really has the partition
 * layout the test claims, so it cannot silently regress to the code defaults.
 *
 * @param {import('knex').Knex} knex
 * @param {string} table
 * @returns {Promise<number>}
 */
const countPartitions = async (knex, table) => {
  const result = await knex.raw(
    `SELECT count(*)::int AS n
       FROM pg_inherits
       JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
      WHERE parent.relname = ?`,
    [table]
  );
  return Number(result.rows[0].n);
};

/**
 * A `pg.Client` config pointed at a local test database, for the COPY paths that need a
 * raw connection rather than knex.
 *
 * @param {string} testDbName
 * @returns {import('pg').ClientConfig}
 */
const localClientConfig = (testDbName) => ({
  host: process.env.PG_HOST ?? 'localhost',
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD ?? 'password',
  database: testDbName,
});

module.exports = {
  DEPLOYED_PARTITION_COUNTS,
  SMALL_PARTITION_COUNTS,
  countPartitions,
  createSeedTestDb,
  localClientConfig,
  teardownSeedTestDb,
};
