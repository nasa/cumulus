'use strict';

const test = require('ava');
const { Client } = require('pg');
const { randomId } = require('@cumulus/common/test-utils');
const { localStackConnectionEnv } = require('@cumulus/db');
const { createBucket, recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');

const { extract } = require('../src/extract');
const { load } = require('../src/load');
const { listLoads, revert } = require('../src/revert');
const {
  DEPLOYED_PARTITION_COUNTS,
  createSeedTestDb,
  localClientConfig,
  teardownSeedTestDb,
} = require('./helpers/testDb');
const { seedSourceDatabase } = require('./helpers/fixture');

// ava hands each test a shallow copy of t.context, so ids produced by one serial test and
// needed by the next live here instead.
const state = {};

const PREFIX = 'load-test';
const SNAPSHOT = 'v1-loadtest';

const COUNTED_TABLES = [
  'collections', 'providers', 'async_operations', 'rules', 'executions', 'pdrs',
  'granules', 'files', 'granules_executions',
  'granules_global_unique', 'files_global_unique', 'executions_global_unique',
];

/**
 * @param {Client} client
 * @returns {Promise<Record<string, number>>}
 */
const countAll = async (client) => {
  const counts = {};
  for (const table of COUNTED_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
    counts[table] = rows[0].n;
  }
  return counts;
};

/**
 * Every table in the target that is not a TEMP table and was not there at the start.
 * A load, dry run or revert must leave this empty.
 *
 * @param {Client} client
 * @returns {Promise<string[]>}
 */
const leftoverTables = async (client) => {
  const { rows } = await client.query(
    `SELECT relname FROM pg_class
      WHERE relkind = 'r' AND relpersistence <> 't' AND relname LIKE 'granule\\_seed%'`
  );
  return rows.map((r) => r.relname);
};

/**
 * Make the local target behave like CC SIT, where pglogical refuses DROP for the Cumulus
 * user: any explicit DROP TABLE raises. Temp tables removed at disconnect are unaffected,
 * as they are on CC SIT.
 *
 * @param {Client} client
 * @returns {Promise<void>}
 */
const forbidDrop = async (client) => {
  await client.query(
    `CREATE FUNCTION granule_seed_test_forbid_drop() RETURNS event_trigger
       LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION 'DROP is forbidden on this target (simulating pglogical on CC SIT)';
     END $$`
  );
  await client.query(
    `CREATE EVENT TRIGGER granule_seed_test_forbid_drop ON ddl_command_start
       WHEN TAG IN ('DROP TABLE', 'DROP SCHEMA')
       EXECUTE FUNCTION granule_seed_test_forbid_drop()`
  );
};

test.before(async (t) => {
  t.timeout(900 * 1000);

  const sourceName = randomId('seedloadsrc').replace(/-/g, '_');
  const targetName = randomId('seedloadtgt').replace(/-/g, '_');

  t.context.source = await createSeedTestDb({ testDbName: sourceName });
  t.context.target = await createSeedTestDb({
    testDbName: targetName,
    partitionCounts: DEPLOYED_PARTITION_COUNTS,
  });

  t.context.sourceClient = new Client(localClientConfig(sourceName));
  await t.context.sourceClient.connect();
  t.context.client = new Client(localClientConfig(targetName));
  await t.context.client.connect();

  await seedSourceDatabase({ client: t.context.sourceClient });

  t.context.bucket = randomId('seed-load').toLowerCase();
  await createBucket(t.context.bucket);

  await extract({
    bucket: t.context.bucket,
    prefix: PREFIX,
    tier: '100',
    snapshot: SNAPSHOT,
    floor: 1,
    env: { ...localStackConnectionEnv, PG_DATABASE: sourceName, DISABLE_PG_SSL: 'true' },
  });

  const { client } = t.context;

  // Unrelated collections first, so target ids differ from source ids in a way that is
  // neither the identity nor a constant offset.
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO collections (name, version, sample_file_name, granule_id_extraction_regex,
         granule_id_validation_regex, files, cmr_provider, metrics_provider)
       VALUES ($1, '009', 'x', 'x', 'x', '[]', 'c', 'm')`,
      [`OTHER_${i}`]
    );
  }

  // Same natural keys as source rows: the load must reuse these, and revert must keep them.
  const { rows: reused } = await client.query(
    `INSERT INTO collections (name, version, sample_file_name, granule_id_extraction_regex,
       granule_id_validation_regex, files, cmr_provider, metrics_provider)
     VALUES ('MOD09GQ_1', '001', 'pre-existing', 'x', 'x', '[]', 'c', 'm')
     RETURNING cumulus_id`
  );
  t.context.reusedCollectionId = Number(reused[0].cumulus_id);
  await client.query(
    'INSERT INTO providers (name, protocol, host) VALUES (\'provider_0\', \'https\', \'pre.example\')'
  );

  // A real granule the load and revert must never touch.
  await client.query(
    `INSERT INTO granules (granule_id, producer_granule_id, status, collection_cumulus_id)
     VALUES ('PRE-EXISTING-GRANULE', 'PRE-EXISTING-GRANULE', 'completed', $1)`,
    [t.context.reusedCollectionId]
  );

  await forbidDrop(client);

  t.context.targetEnv = {
    ...localStackConnectionEnv, PG_DATABASE: targetName, DISABLE_PG_SSL: 'true',
  };
  t.context.baseline = await countAll(client);
});

test.after.always(async (t) => {
  if (t.context.client) await t.context.client.end();
  if (t.context.sourceClient) await t.context.sourceClient.end();
  if (t.context.bucket) await recursivelyDeleteS3Bucket(t.context.bucket);
  if (t.context.source) await teardownSeedTestDb(t.context.source);
  if (t.context.target) await teardownSeedTestDb(t.context.target);
});

const loadParams = (t, tier, extra = {}) => ({
  bucket: t.context.bucket,
  prefix: PREFIX,
  snapshot: SNAPSHOT,
  tier,
  env: t.context.targetEnv,
  ...extra,
});

const recordParams = (t, extra = {}) => ({
  bucket: t.context.bucket,
  prefix: PREFIX,
  env: t.context.targetEnv,
  ...extra,
});

test.serial('the target refuses DROP TABLE, like CC SIT', async (t) => {
  await t.throwsAsync(
    t.context.client.query('CREATE TABLE granule_seed_drop_probe (a int); '
      + 'DROP TABLE granule_seed_drop_probe'),
    { message: /DROP is forbidden/ }
  );
  // The failed multi-statement query rolled back its CREATE too.
  t.deepEqual(await leftoverTables(t.context.client), []);
});

test.serial('a dry run stages and checks, then leaves the target untouched', async (t) => {
  const result = await load(loadParams(t, '10', { dryRun: true }));

  t.true(result.dryRun);
  t.is(result.staged.granules, 10);
  t.deepEqual(await countAll(t.context.client), t.context.baseline);
  t.deepEqual(await leftoverTables(t.context.client), []);
  t.deepEqual(await listLoads(recordParams(t)), [], 'a dry run writes no load record');
});

test.serial('loading the 10 tier inserts the bundle with every key remapped', async (t) => {
  const { client } = t.context;
  const result = await load(loadParams(t, '10'));
  state.firstLoadId = result.loadId;
  state.firstInserted = result.inserted;

  t.is(result.inserted.granules, 10);
  t.is(result.inserted.files, result.staged.files);
  t.is(result.synthesizedExecutions, 20, 'two synthetic executions per granule by default');
  t.is(result.inserted.executions, result.staged.executions + 20);
  t.is(result.inserted.granules_executions, result.staged.granules_executions + 20);
  t.is(result.inserted.pdrs, result.staged.pdrs);
  t.true(result.inserted.rules > 0);

  t.deepEqual(await leftoverTables(client), [], 'staging was TEMP and is gone');

  const [record] = await listLoads(recordParams(t));
  t.like(record, { loadId: result.loadId, status: 'complete', tier: '10' });
  t.is(record.ids, undefined, 'the listing leaves out the id lists');

  const after = await countAll(client);
  t.is(after.granules, t.context.baseline.granules + 10);
  t.is(after.granules_global_unique, after.granules, 'guard table kept in step by triggers');
  t.is(after.files_global_unique, after.files);
  t.is(after.executions_global_unique, after.executions);

  // Granule ids are loaded verbatim.
  const { rows: ids } = await client.query(
    'SELECT count(*)::int AS n FROM granules WHERE granule_id LIKE \'MOD09GQ.A%\''
  );
  t.is(ids[0].n, 10);
});

test.serial('files and granule-execution links carry their granule\'s target collection',
  async (t) => {
    const { rows } = await t.context.client.query(
      `SELECT
         (SELECT count(*)::int FROM files f JOIN granules g
            ON g.cumulus_id = f.granule_cumulus_id
           AND g.collection_cumulus_id = f.collection_cumulus_id
          WHERE g.granule_id LIKE 'MOD09GQ.A%') AS files_ok,
         (SELECT count(*)::int FROM files f
           WHERE f.key LIKE '%MOD09GQ.A%') AS files_total,
         (SELECT count(*)::int FROM granules_executions ge JOIN granules g
            ON g.cumulus_id = ge.granule_cumulus_id
           AND g.collection_cumulus_id = ge.collection_cumulus_id
          WHERE g.granule_id LIKE 'MOD09GQ.A%') AS links`
    );
    t.true(rows[0].files_total > 0);
    t.is(rows[0].files_ok, rows[0].files_total);
    t.true(rows[0].links > 0);
  });

test.serial('synthetic executions are linked, recent, and point at no real resource',
  async (t) => {
    const { rows } = await t.context.client.query(
      `SELECT e.arn, e.url, e.status, e.workflow_name, e.collection_cumulus_id,
              g.collection_cumulus_id AS granule_collection,
              p.relname AS partition
         FROM executions e
         JOIN pg_class p ON p.oid = e.tableoid
         JOIN granules_executions ge
           ON ge.execution_cumulus_id = e.cumulus_id
          AND ge.execution_created_at = e.created_at
         JOIN granules g
           ON g.cumulus_id = ge.granule_cumulus_id
          AND g.collection_cumulus_id = ge.collection_cumulus_id
        WHERE e.arn LIKE '%:granule-seed-%'`
    );

    t.is(rows.length, 20);
    rows.forEach((row) => {
      t.regex(row.arn, /^arn:aws:states:us-west-2:0{12}:execution:granule-se{2}d-/);
      t.true(row.url.endsWith(row.arn));
      t.not(row.partition, 'executions_default', 'recent created_at lands in a quarter');
      t.is(row.collection_cumulus_id, row.granule_collection);
      t.true(['completed', 'failed', 'running'].includes(row.status));
      t.true(['IngestGranule', 'PublishGranule'].includes(row.workflow_name));
    });
  });

test.serial('an existing collection with the same name and version is reused', async (t) => {
  const { rows } = await t.context.client.query(
    `SELECT c.cumulus_id, c.sample_file_name, count(g.*)::int AS granules
       FROM collections c LEFT JOIN granules g ON g.collection_cumulus_id = c.cumulus_id
      WHERE c.name = 'MOD09GQ_1' AND c.version = '001'
      GROUP BY c.cumulus_id, c.sample_file_name`
  );
  t.is(rows.length, 1, 'not duplicated');
  t.is(Number(rows[0].cumulus_id), t.context.reusedCollectionId);
  t.is(rows[0].sample_file_name, 'pre-existing', 'the existing row was not overwritten');
});

test.serial('seeded rules are disabled with no trigger ARNs', async (t) => {
  const { rows } = await t.context.client.query(
    `SELECT name, enabled, arn, log_event_arn, collection_cumulus_id FROM rules
      WHERE name LIKE 'seed_rule_%'`
  );
  t.true(rows.length > 0);
  rows.forEach((rule) => {
    t.false(rule.enabled);
    t.is(rule.arn, null);
    t.is(rule.log_event_arn, null);
    t.truthy(rule.collection_cumulus_id);
  });
});

test.serial('loading overlapping data again is refused before anything is written',
  async (t) => {
    const before = await countAll(t.context.client);

    const error = await t.throwsAsync(load(loadParams(t, '100')));
    t.regex(error.message, /granule_id\(s\) already exist/);
    t.regex(error.message, /Revert the earlier load/);

    t.deepEqual(await countAll(t.context.client), before);
    t.deepEqual(await leftoverTables(t.context.client), []);
    t.is((await listLoads(recordParams(t))).length, 1, 'a refused load writes no record');
  });

test.serial('revert restores the target exactly, keeping pre-existing rows', async (t) => {
  const deleted = await revert(recordParams(t, { loadId: state.firstLoadId }));
  t.is(deleted.granules, 10);
  t.deepEqual(deleted, state.firstInserted, 'revert deletes exactly what the load inserted');

  t.deepEqual(await countAll(t.context.client), t.context.baseline);

  const { rows } = await t.context.client.query(
    `SELECT
       (SELECT count(*)::int FROM granules WHERE granule_id = 'PRE-EXISTING-GRANULE') AS g,
       (SELECT count(*)::int FROM collections WHERE name = 'MOD09GQ_1') AS c,
       (SELECT count(*)::int FROM providers WHERE name = 'provider_0') AS p`
  );
  t.deepEqual(rows[0], { g: 1, c: 1, p: 1 });
  t.deepEqual(await leftoverTables(t.context.client), []);

  const [record] = await listLoads(recordParams(t));
  t.is(record.status, 'reverted');
});

test.serial('after a revert the larger tier loads', async (t) => {
  const result = await load(loadParams(t, '100', { executionsPerGranule: 0 }));
  t.is(result.inserted.granules, 100);
  t.is(result.synthesizedExecutions, 0, '--executions-per-granule 0 generates none');

  state.secondLoadId = result.loadId;
  const deleted = await revert(recordParams(t, { loadId: result.loadId }));
  t.is(deleted.granules, 100);
  t.deepEqual(await countAll(t.context.client), t.context.baseline);
});

test.serial('revert refuses unknown, already-reverted, and wrong-database loads',
  async (t) => {
    await t.throwsAsync(revert(recordParams(t, { loadId: 'deadbeef' })), {
      message: /No load record/,
    });
    await t.throwsAsync(revert(recordParams(t, { loadId: state.secondLoadId })), {
      message: /status "reverted"/,
    });

    const result = await load(loadParams(t, '10', { executionsPerGranule: 0 }));
    await t.throwsAsync(
      revert(recordParams(t, {
        loadId: result.loadId,
        env: { ...t.context.targetEnv, PG_DATABASE: t.context.source.testDbName },
      })),
      { message: /Refusing to revert/ }
    );
    await revert(recordParams(t, { loadId: result.loadId }));
    t.deepEqual(await countAll(t.context.client), t.context.baseline);
  });
