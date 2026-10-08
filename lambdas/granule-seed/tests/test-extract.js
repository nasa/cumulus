'use strict';

/* eslint-disable no-await-in-loop */

const test = require('ava');
const zlib = require('zlib');
const { Client } = require('pg');
const { randomId } = require('@cumulus/common/test-utils');
const { localStackConnectionEnv } = require('@cumulus/db');
const {
  createBucket,
  getJsonS3Object,
  getObject,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');

const { extract } = require('../src/extract');
const {
  estimateCollectionStats,
  extractionQueries,
  getCollectionStats,
} = require('../src/sample');
const { introspectTables } = require('../src/schema');
const { manifestKey, tableKey } = require('../src/bundle');
const { SEED_TABLES } = require('../src/schema');
const {
  DEPLOYED_PARTITION_COUNTS,
  countPartitions,
  createSeedTestDb,
  localClientConfig,
  teardownSeedTestDb,
} = require('./helpers/testDb');
const { seedSourceDatabase } = require('./helpers/fixture');
const { parseCsvRecords } = require('./helpers/csv');

const PREFIX = 'unit-test-stack';
const SNAPSHOT = 'v1-test';

/**
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<string>}
 */
const getGunzippedCsv = async (bucket, key) => {
  const response = await getObject(s3(), { Bucket: bucket, Key: key });
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return zlib.gunzipSync(Buffer.concat(chunks)).toString('utf8');
};

/**
 * Fetch and parse one table's CSV for one tier.
 *
 * @param {string} bucket
 * @param {string} tier
 * @param {string} table
 * @returns {Promise<{header: string[], records: object[]}>}
 */
const loadTierTable = async (bucket, tier, table) => parseCsvRecords(
  await getGunzippedCsv(
    bucket,
    tableKey({ prefix: PREFIX, snapshotVersion: SNAPSHOT, tier, table })
  )
);

test.before(async (t) => {
  t.timeout(600 * 1000);

  const testDbName = randomId('seedextract').replace(/-/g, '_');
  Object.assign(
    t.context,
    await createSeedTestDb({ testDbName, partitionCounts: DEPLOYED_PARTITION_COUNTS })
  );

  t.context.client = new Client(localClientConfig(testDbName));
  await t.context.client.connect();

  t.context.fixture = await seedSourceDatabase({
    client: t.context.client,
    collectionCount: 4,
    granulesPerCollection: 25,
    filesPerGranule: 3,
  });

  t.context.bucket = randomId('seed-bucket').toLowerCase();
  await createBucket(t.context.bucket);

  t.context.env = {
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    DISABLE_PG_SSL: 'true',
  };

  // One extraction run writes every tier up to 100 granules; the fixture holds 100.
  t.context.result = await extract({
    bucket: t.context.bucket,
    prefix: PREFIX,
    tier: '100',
    snapshot: SNAPSHOT,
    floor: 1,
    sourceLabel: 'fixture-source',
    env: t.context.env,
  });
});

test.after.always(async (t) => {
  if (t.context.client) await t.context.client.end();
  if (t.context.bucket) await recursivelyDeleteS3Bucket(t.context.bucket);
  await teardownSeedTestDb(t.context);
});

test('the fixture database really has the deployed partition layout', async (t) => {
  t.is(await countPartitions(t.context.knex, 'granules'), 64);
  t.is(await countPartitions(t.context.knex, 'files'), 256);
  t.is(await countPartitions(t.context.knex, 'granules_global_unique'), 16);
});

test('extract writes a manifest for every tier up to the requested one', async (t) => {
  const { bucket } = t.context;

  for (const tier of ['10', '100']) {
    const manifest = await getJsonS3Object(
      bucket,
      manifestKey({ prefix: PREFIX, snapshotVersion: SNAPSHOT, tier })
    );
    t.is(manifest.tier, tier);
    t.is(manifest.bundleFormatVersion, 1);
  }
});

test('extract does not write tiers above the requested one', async (t) => {
  const { bucket } = t.context;
  await t.throwsAsync(
    getJsonS3Object(bucket, manifestKey({
      prefix: PREFIX, snapshotVersion: SNAPSHOT, tier: '1k',
    }))
  );
});

test('every tier bundle contains a CSV for every closure table', async (t) => {
  const { bucket } = t.context;

  for (const tier of ['10', '100']) {
    const manifest = await getJsonS3Object(
      bucket,
      manifestKey({ prefix: PREFIX, snapshotVersion: SNAPSHOT, tier })
    );
    t.deepEqual(
      manifest.tables.map((tbl) => tbl.name).sort(),
      [...SEED_TABLES].sort(),
      `tier ${tier} should describe every closure table`
    );

    for (const table of SEED_TABLES) {
      const csv = await getGunzippedCsv(
        bucket,
        tableKey({ prefix: PREFIX, snapshotVersion: SNAPSHOT, tier, table })
      );
      t.true(csv.length > 0, `tier ${tier} ${table}.csv.gz should not be empty`);
    }
  }
});

test('manifest row counts match the CSV record counts exactly', async (t) => {
  const { bucket } = t.context;

  const manifest = await getJsonS3Object(
    bucket,
    manifestKey({ prefix: PREFIX, snapshotVersion: SNAPSHOT, tier: '100' })
  );

  for (const entry of manifest.tables) {
    const { records } = await loadTierTable(bucket, '100', entry.name);
    t.is(
      records.length,
      entry.rowCount,
      `${entry.name}: manifest rowCount must equal the parsed CSV record count`
    );
  }
});

test('the manifest column list matches each CSV header in order', async (t) => {
  const { bucket } = t.context;

  const manifest = await getJsonS3Object(
    bucket,
    manifestKey({ prefix: PREFIX, snapshotVersion: SNAPSHOT, tier: '100' })
  );

  for (const entry of manifest.tables) {
    const { header } = await loadTierTable(bucket, '100', entry.name);
    t.deepEqual(
      header,
      entry.columns.map((c) => c.column),
      `${entry.name}: the manifest's column order is the CSV's column order`
    );
  }
});

test('awkward field values survive into the bundle intact', async (t) => {
  const { records } = await loadTierTable(t.context.bucket, '10', 'granules');

  records.forEach((granule) => {
    t.is(granule.product_volume, '9007199254740993', 'bigint above 2^53 kept exactly');
    t.deepEqual(
      JSON.parse(granule.error),
      { Error: 'None', Cause: 'multi\nline, "quoted"' },
      'jsonb with a newline, a comma and quotes parses back to the original'
    );
  });

  const { records: providers } = await loadTierTable(t.context.bucket, '10', 'providers');
  const withRedirects = providers.filter((p) => p.name.startsWith('provider_'));
  t.true(withRedirects.length > 0);
  withRedirects.forEach((provider) => {
    t.is(provider.allowed_redirects, '{"a,b",c}', 'text[] with an embedded comma');
  });
});

test('tiers are nested: the 10-tier granules are a subset of the 100-tier', async (t) => {
  const { bucket } = t.context;

  const small = (await loadTierTable(bucket, '10', 'granules')).records
    .map((g) => g.granule_id);
  const large = new Set(
    (await loadTierTable(bucket, '100', 'granules')).records.map((g) => g.granule_id)
  );

  t.is(small.length, 10);
  t.is(large.size, 100);
  small.forEach((granuleId) => {
    t.true(large.has(granuleId), `${granuleId} from the 10-tier must be in the 100-tier`);
  });
});

test('the smallest tier still spans more than one collection', async (t) => {
  const { records } = await loadTierTable(t.context.bucket, '10', 'granules');
  const collections = new Set(records.map((g) => g.collection_cumulus_id));

  t.true(
    collections.size > 1,
    `a 10-granule tier should be stratified, saw ${collections.size} collection(s)`
  );
});

test('every bundle FK closes within its own tier', async (t) => {
  const { bucket } = t.context;

  for (const tier of ['10', '100']) {
    const load = async (table) => (await loadTierTable(bucket, tier, table)).records;
    const [
      collections, providers, asyncOps, rules, executions, pdrs, granules, files, joins,
    ] = await Promise.all([
      load('collections'), load('providers'), load('async_operations'), load('rules'),
      load('executions'), load('pdrs'), load('granules'), load('files'),
      load('granules_executions'),
    ]);

    const ids = (rows) => new Set(rows.map((r) => r.cumulus_id));
    const collectionIds = ids(collections);
    const providerIds = ids(providers);
    const asyncIds = ids(asyncOps);
    const pdrIds = ids(pdrs);
    const executionKeys = new Set(executions.map((e) => `${e.cumulus_id}|${e.created_at}`));
    const granuleKeys = new Set(
      granules.map((g) => `${g.cumulus_id}|${g.collection_cumulus_id}`)
    );

    t.true(files.length > 0 && joins.length > 0 && pdrs.length > 0, `tier ${tier} populated`);

    granules.forEach((g) => {
      t.true(collectionIds.has(g.collection_cumulus_id), 'granule -> collection');
      if (g.pdr_cumulus_id !== null) t.true(pdrIds.has(g.pdr_cumulus_id), 'granule -> pdr');
      if (g.provider_cumulus_id !== null) {
        t.true(providerIds.has(g.provider_cumulus_id), 'granule -> provider');
      }
    });

    files.forEach((f) => {
      t.true(
        granuleKeys.has(`${f.granule_cumulus_id}|${f.collection_cumulus_id}`),
        'file -> (granule, collection) composite FK'
      );
    });

    joins.forEach((j) => {
      t.true(granuleKeys.has(`${j.granule_cumulus_id}|${j.collection_cumulus_id}`),
        'granules_executions -> (granule, collection)');
      t.true(executionKeys.has(`${j.execution_cumulus_id}|${j.execution_created_at}`),
        'granules_executions -> (execution, created_at)');
    });

    pdrs.forEach((p) => {
      t.true(collectionIds.has(p.collection_cumulus_id), 'pdr -> collection');
      t.true(providerIds.has(p.provider_cumulus_id), 'pdr -> provider');
      if (p.execution_cumulus_id !== null) {
        t.true(executionKeys.has(`${p.execution_cumulus_id}|${p.execution_created_at}`),
          'pdr -> (execution, created_at)');
      }
    });

    t.true(rules.length > 0, `tier ${tier} carries rules`);
    rules.forEach((r) => {
      t.true(collectionIds.has(r.collection_cumulus_id), 'rule -> collection');
      if (r.provider_cumulus_id !== null) {
        t.true(providerIds.has(r.provider_cumulus_id), 'rule -> provider');
      }
    });

    executions.forEach((e) => {
      if (e.collection_cumulus_id !== null) {
        t.true(collectionIds.has(e.collection_cumulus_id), 'execution -> collection');
      }
      if (e.async_operation_cumulus_id !== null) {
        t.true(asyncIds.has(e.async_operation_cumulus_id), 'execution -> async_operation');
      }
    });
  }
});

test('rules are copied disabled with their trigger ARNs cleared', async (t) => {
  const { records: rules } = await loadTierTable(t.context.bucket, '100', 'rules');

  t.is(rules.length, 4, 'one rule per sampled collection');
  rules.forEach((rule) => {
    t.is(rule.enabled, 'f', `${rule.name} must be disabled`);
    t.is(rule.arn, null, `${rule.name} must not name the source's trigger resource`);
    t.is(rule.log_event_arn, null, `${rule.name} must not name the source's log trigger`);
    t.regex(rule.value, /^arn:aws:kinesis/, 'other columns are copied verbatim');
  });
});

test('a provider referenced only by a rule is pulled into the bundle', async (t) => {
  const { records: providers } = await loadTierTable(t.context.bucket, '100', 'providers');
  t.true(providers.some((p) => p.name === 'rule_only_provider'));
});

test('an execution whose parent is outside the tier has both parent columns NULL', async (t) => {
  const { records } = await loadTierTable(t.context.bucket, '10', 'executions');
  const selfKeys = new Set(records.map((e) => `${e.cumulus_id}|${e.created_at}`));

  let severed = 0;
  let kept = 0;
  records.forEach((e) => {
    if (e.parent_cumulus_id === null) {
      t.is(e.parent_created_at, null, 'both halves of the composite self-FK go NULL together');
      severed += 1;
    } else {
      t.true(
        selfKeys.has(`${e.parent_cumulus_id}|${e.parent_created_at}`),
        'a retained parent reference must resolve within the tier'
      );
      kept += 1;
    }
  });

  t.true(severed > 0, 'the fixture should produce severed parent references');
  t.true(kept > 0, 'the fixture should also produce retained parent references');
});

test('extract reports the measured files-per-granule ratio', (t) => {
  const tier100 = t.context.result.tiers.find((m) => m.tier === '100');

  t.is(tier100.stats.granuleCount, 100);
  t.is(tier100.stats.fileCount, 300);
  t.is(tier100.stats.filesPerGranule, 3, 'measured, not assumed');
});

test('extract records the source fingerprint, partition counts and migration head', (t) => {
  const { result } = t.context;

  t.regex(result.fingerprint, /^sha256:[\da-f]{64}$/);
  t.is(result.source.label, 'fixture-source');
  t.is(result.source.partitionCounts.granules, 64);
  t.is(result.source.partitionCounts.files, 256);
  t.truthy(result.source.migrationHead);
});

test.serial('statistics-based collection counts agree with exact counts', async (t) => {
  const { client } = t.context;

  // Unanalyzed: no statistics, so the estimate is empty and the exact count is used.
  t.deepEqual(await estimateCollectionStats(client), []);
  const exact = await getCollectionStats(client);

  await client.query('ANALYZE granules');
  const estimated = await estimateCollectionStats(client);

  t.deepEqual(
    estimated.map((s) => s.collectionCumulusId).sort(),
    exact.map((s) => s.collectionCumulusId).sort(),
    'every collection appears in the statistics'
  );
  estimated.forEach((stat) => {
    const actual = exact.find((s) => s.collectionCumulusId === stat.collectionCumulusId);
    t.true(Math.abs(stat.granuleCount - actual.granuleCount) <= 1,
      `collection ${stat.collectionCumulusId}: estimated ${stat.granuleCount}, `
        + `actual ${actual.granuleCount}`);
  });
});

test.serial('per-granule extraction queries are driven by the sample, never a table join',
  async (t) => {
    const { client } = t.context;
    const introspection = await introspectTables(client, SEED_TABLES);

    await client.query('BEGIN');
    try {
      await client.query(`CREATE TEMP TABLE seed_sample (
        cumulus_id BIGINT NOT NULL, collection_cumulus_id INTEGER NOT NULL,
        granule_id TEXT NOT NULL, updated_at TIMESTAMPTZ, provider_cumulus_id INTEGER,
        pdr_cumulus_id INTEGER, ord BIGINT, PRIMARY KEY (cumulus_id, collection_cumulus_id))`);
      await client.query(`INSERT INTO seed_sample
        SELECT g, 1, 'x' || g, now(), NULL, NULL, g FROM generate_series(1, 1000) g`);
      // Tell the planner the sample is large, as at the 1m tier: that is when a hash or
      // merge join against the whole child table looks attractive.
      await client.query('ANALYZE seed_sample');

      const queries = extractionQueries({ introspection, limit: 1_000_000 });
      for (const table of ['granules', 'files', 'granules_executions']) {
        const { rows } = await client.query(`EXPLAIN ${queries[table]}`);
        const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
        t.regex(plan, /^Nested Loop/, `${table} must be a nested loop over the sample`);
        t.notRegex(plan, /Hash Join|Merge Join/, `${table} must not join the whole table`);
      }
    } finally {
      await client.query('ROLLBACK');
    }
  });

test('a dry run plans without writing anything', async (t) => {
  const bucket = randomId('seed-dry').toLowerCase();
  await createBucket(bucket);

  try {
    const result = await extract({
      bucket,
      prefix: PREFIX,
      tier: '10',
      snapshot: 'v1-dry',
      floor: 1,
      dryRun: true,
      env: t.context.env,
    });

    t.true(result.dryRun);
    t.truthy(result.sampling.allocations.length);
    await t.throwsAsync(
      getJsonS3Object(bucket, manifestKey({
        prefix: PREFIX, snapshotVersion: 'v1-dry', tier: '10',
      }))
    );
  } finally {
    await recursivelyDeleteS3Bucket(bucket);
  }
});

test('the top-level manifest summarises every tier written', async (t) => {
  const manifest = await getJsonS3Object(
    t.context.bucket,
    manifestKey({ prefix: PREFIX, snapshotVersion: SNAPSHOT })
  );

  t.is(manifest.snapshotVersion, SNAPSHOT);
  t.deepEqual(manifest.tiers.map((tier) => tier.tier), ['10', '100']);
});

/* eslint-enable no-await-in-loop */
