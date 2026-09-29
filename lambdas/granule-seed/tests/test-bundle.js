'use strict';

const test = require('ava');

const {
  TIERS,
  assertManifestUsable,
  buildTierManifest,
  getTier,
  manifestKey,
  tableKey,
  tiersUpTo,
} = require('../src/bundle');
const { SEED_TABLES } = require('../src/schema');

test('the tier ladder is strictly increasing', (t) => {
  const sizes = TIERS.map((tier) => tier.granules);
  t.deepEqual(sizes, [10, 100, 1000, 10_000, 100_000, 1_000_000]);
});

test('getTier rejects an unknown tier and names the valid ones', (t) => {
  t.throws(() => getTier('2k'), { message: /Valid tiers: 10, 100, 1k, 10k, 100k, 1m/ });
});

test('tiersUpTo returns every tier at or below the requested one, smallest first', (t) => {
  t.deepEqual(tiersUpTo('1k').map((tier) => tier.name), ['10', '100', '1k']);
  t.deepEqual(tiersUpTo('10').map((tier) => tier.name), ['10']);
});

test('keys follow the versioned bundle layout', (t) => {
  const params = { prefix: 'stack', snapshotVersion: 'v1-2026-09-23' };
  t.is(manifestKey(params), 'stack/granule-seed/v1/v1-2026-09-23/manifest.json');
  t.is(
    manifestKey({ ...params, tier: '1k' }),
    'stack/granule-seed/v1/v1-2026-09-23/1k/manifest.json'
  );
  t.is(
    tableKey({ ...params, tier: '1k', table: 'files' }),
    'stack/granule-seed/v1/v1-2026-09-23/1k/files.csv.gz'
  );
});

test('buildTierManifest records the measured files-per-granule ratio', (t) => {
  const manifest = buildTierManifest({
    tier: getTier('100'),
    parentTier: '10',
    source: {},
    tables: [
      { name: 'granules', rowCount: 100 },
      { name: 'files', rowCount: 420 },
    ],
  });

  t.is(manifest.stats.filesPerGranule, 4.2);
  t.is(manifest.parentTier, '10');
  t.is(manifest.requestedGranules, 100);
});

test('assertManifestUsable rejects an unknown format version', (t) => {
  t.throws(() => assertManifestUsable({ bundleFormatVersion: 99, tables: [] }), {
    message: /Unsupported bundleFormatVersion 99/,
  });
});

test('assertManifestUsable rejects a manifest missing a closure table', (t) => {
  const tables = SEED_TABLES.filter((name) => name !== 'files').map((name) => ({ name }));
  t.throws(() => assertManifestUsable({ bundleFormatVersion: 1, tables }), {
    message: /missing table entries: files/,
  });
});

test('assertManifestUsable accepts a complete manifest', (t) => {
  const tables = SEED_TABLES.map((name) => ({ name }));
  t.notThrows(() => assertManifestUsable({ bundleFormatVersion: 1, tables }));
});
