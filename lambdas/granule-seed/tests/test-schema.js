'use strict';

const test = require('ava');
const { Client } = require('pg');
const { randomId } = require('@cumulus/common/test-utils');

const {
  EXCLUDED_TABLES,
  SEED_TABLES,
  assertTablesPresent,
  introspectTables,
  negotiate,
  negotiateTable,
  schemaFingerprint,
} = require('../src/schema');
const {
  createSeedTestDb,
  localClientConfig,
  teardownSeedTestDb,
} = require('./helpers/testDb');

test.before(async (t) => {
  t.timeout(300 * 1000);
  const testDbName = randomId('seedschema').replace(/-/g, '_');
  Object.assign(t.context, await createSeedTestDb({ testDbName }));

  t.context.client = new Client(localClientConfig(testDbName));
  await t.context.client.connect();
  t.context.introspection = await introspectTables(t.context.client, SEED_TABLES);
});

test.after.always(async (t) => {
  if (t.context.client) await t.context.client.end();
  await teardownSeedTestDb(t.context);
});

test('SEED_TABLES is the granule closure in dependency order', (t) => {
  t.deepEqual([...SEED_TABLES], [
    'collections',
    'providers',
    'async_operations',
    'rules',
    'executions',
    'pdrs',
    'granules',
    'files',
    'granules_executions',
  ]);
});

test('SEED_TABLES includes rules and excludes reconciliation_reports', (t) => {
  t.true(SEED_TABLES.includes('rules'), 'CUMULUS-5444 asks for seeded rules');
  t.false(SEED_TABLES.includes('reconciliation_reports'));
});

test('EXCLUDED_TABLES covers the trigger-maintained guard tables and their leftovers', (t) => {
  ['granules_global_unique', 'files_global_unique', 'executions_global_unique',
    'granules_global_unique_old_non_partitioned',
    'files_global_unique_old_non_partitioned'].forEach((table) => {
    t.true(EXCLUDED_TABLES.includes(table), `${table} must be excluded`);
  });
});

test('introspectTables returns every seed table', (t) => {
  SEED_TABLES.forEach((table) => {
    t.true(
      (t.context.introspection[table] ?? []).length > 0,
      `${table} should have columns`
    );
  });
});

test('introspectTables records the composite-FK columns the loader depends on', (t) => {
  const columnNames = (table) => t.context.introspection[table].map((c) => c.column);

  // files and granules_executions both carry collection_cumulus_id; an offset-only
  // remapping of granule ids would leave these pointing at the wrong collection.
  t.true(columnNames('files').includes('collection_cumulus_id'));
  t.true(columnNames('files').includes('granule_cumulus_id'));
  t.true(columnNames('granules_executions').includes('collection_cumulus_id'));
  t.true(columnNames('granules_executions').includes('execution_created_at'));
  // pdrs carries the executions composite FK's timestamp half.
  t.true(columnNames('pdrs').includes('execution_created_at'));
  // executions' self-FK is composite too.
  t.true(columnNames('executions').includes('parent_created_at'));
});

test('introspectTables preserves ordinal order', (t) => {
  const ordinals = t.context.introspection.granules.map((c) => c.ordinal);
  t.deepEqual(ordinals, [...ordinals].sort((a, b) => a - b));
});

test('collections.metrics_provider is NOT NULL with no default', (t) => {
  const column = t.context.introspection.collections
    .find((c) => c.column === 'metrics_provider');

  t.truthy(column, 'metrics_provider should exist at this migration head');
  t.false(column.isNullable);
  t.false(column.hasDefault, 'this is why a pre-20260527 bundle cannot load without --fill');
});

test('schemaFingerprint is stable across calls', (t) => {
  t.is(
    schemaFingerprint(t.context.introspection),
    schemaFingerprint(t.context.introspection)
  );
});

test('schemaFingerprint ignores column order but reacts to type changes', (t) => {
  const { granules, ...rest } = t.context.introspection;
  const reordered = { ...rest, granules: [...granules].reverse() };
  t.is(
    schemaFingerprint(t.context.introspection),
    schemaFingerprint(reordered),
    'reordering alone is not a breaking change'
  );

  const retyped = {
    ...rest,
    granules: granules.map((c, i) => (i === 0 ? { ...c, udtName: 'somethingelse' } : c)),
  };
  t.not(schemaFingerprint(t.context.introspection), schemaFingerprint(retyped));
});

test('assertTablesPresent names the missing tables', (t) => {
  t.throws(
    () => assertTablesPresent({ collections: [{ column: 'a' }] }, ['collections', 'granules']),
    { message: /missing expected table\(s\): granules/ }
  );
});

// --- negotiateTable, the interesting cases -------------------------------------------

const column = (name, overrides = {}) => ({
  column: name,
  dataType: 'text',
  udtName: 'text',
  isNullable: true,
  hasDefault: false,
  ordinal: 1,
  ...overrides,
});

test('negotiateTable copies matching columns', (t) => {
  const result = negotiateTable({
    table: 'collections',
    bundleColumns: [column('a'), column('b')],
    targetColumns: [column('a'), column('b')],
  });

  t.deepEqual(result.copyColumns, ['a', 'b']);
  t.deepEqual(result.errors, []);
});

test('negotiateTable drops a nullable target-only column so the default applies', (t) => {
  const result = negotiateTable({
    table: 'collections',
    bundleColumns: [column('a')],
    targetColumns: [column('a'), column('added', { isNullable: true })],
  });

  t.deepEqual(result.copyColumns, ['a']);
  t.deepEqual(result.dropped, ['added']);
  t.deepEqual(result.errors, []);
});

test('negotiateTable drops a defaulted NOT NULL target-only column', (t) => {
  const result = negotiateTable({
    table: 'granules',
    bundleColumns: [column('a')],
    targetColumns: [column('a'), column('archived', { isNullable: false, hasDefault: true })],
  });

  t.deepEqual(result.dropped, ['archived']);
  t.deepEqual(result.errors, []);
});

test('negotiateTable aborts on a NOT NULL target-only column with no default', (t) => {
  const result = negotiateTable({
    table: 'collections',
    bundleColumns: [column('a')],
    targetColumns: [
      column('a'),
      column('metrics_provider', { isNullable: false, hasDefault: false }),
    ],
  });

  t.is(result.errors.length, 1);
  t.regex(result.errors[0], /collections\.metrics_provider/);
  t.regex(result.errors[0], /--fill collections\.metrics_provider=/);
});

test('negotiateTable accepts a --fill for that column instead', (t) => {
  const result = negotiateTable({
    table: 'collections',
    bundleColumns: [column('a')],
    targetColumns: [
      column('a'),
      column('metrics_provider', { isNullable: false, hasDefault: false }),
    ],
    fills: { 'collections.metrics_provider': 'unknown' },
  });

  t.deepEqual(result.errors, []);
  t.deepEqual(result.filled, ['metrics_provider']);
});

test('negotiateTable aborts on a bundle-only column', (t) => {
  const result = negotiateTable({
    table: 'granules',
    bundleColumns: [column('a'), column('removed')],
    targetColumns: [column('a')],
  });

  t.is(result.errors.length, 1);
  t.regex(result.errors[0], /granules\.removed is in the bundle but not in the target/);
});

test('negotiateTable aborts on a type change under the same name', (t) => {
  const result = negotiateTable({
    table: 'granules',
    bundleColumns: [column('product_volume', { udtName: 'int8' })],
    targetColumns: [column('product_volume', { udtName: 'numeric' })],
  });

  t.is(result.errors.length, 1);
  t.regex(result.errors[0], /changed type under the same name/);
  t.regex(result.errors[0], /int8.*numeric/);
});

test('negotiate reports every incompatibility, not just the first', (t) => {
  const error = t.throws(() => negotiate({
    bundleTables: {
      granules: [column('gone')],
      files: [column('alsogone')],
    },
    targetIntrospection: { granules: [], files: [] },
  }));

  t.regex(error.message, /granules\.gone/);
  t.regex(error.message, /files\.alsogone/);
});

test('negotiate accepts a bundle that matches the live schema exactly', (t) => {
  const bundleTables = {};
  SEED_TABLES.forEach((table) => {
    bundleTables[table] = t.context.introspection[table];
  });

  const result = negotiate({
    bundleTables,
    targetIntrospection: t.context.introspection,
  });

  SEED_TABLES.forEach((table) => {
    t.deepEqual(
      result[table].copyColumns,
      t.context.introspection[table].map((c) => c.column),
      `${table} should round-trip every column`
    );
    t.deepEqual(result[table].dropped, []);
  });
});
