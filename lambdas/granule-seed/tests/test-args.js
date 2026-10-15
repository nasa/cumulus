'use strict';

const test = require('ava');

const {
  defaultSnapshotVersion,
  parseExtractArgs,
  parseFills,
  parseLoadArgs,
  parseRevertArgs,
} = require('../src/args');

/**
 * minimist is given the whole `process.argv` by the sibling scripts in this repo, so the
 * helper mirrors that: two placeholder entries then the real flags.
 *
 * @param {string[]} flags
 * @returns {string[]}
 */
const argv = (...flags) => ['/usr/bin/node', '/path/to/extract.js', ...flags];

test('defaultSnapshotVersion is v1-YYYY-MM-DD', (t) => {
  t.is(defaultSnapshotVersion(new Date('2026-09-23T14:02:00Z')), 'v1-2026-09-23');
});

test('parseExtractArgs requires a bucket unless dry-run', (t) => {
  t.throws(() => parseExtractArgs(argv(), {}), { message: /--bucket .* is required/ });
  t.notThrows(() => parseExtractArgs(argv('--dry-run'), {}));
});

test('parseExtractArgs reads the bucket from SEED_BUCKET', (t) => {
  const args = parseExtractArgs(argv(), { SEED_BUCKET: 'env-bucket' });
  t.is(args.bucket, 'env-bucket');
});

test('parseExtractArgs lets the CLI win over the environment', (t) => {
  const args = parseExtractArgs(argv('--bucket', 'cli-bucket'), { SEED_BUCKET: 'env' });
  t.is(args.bucket, 'cli-bucket');
});

test('parseExtractArgs supports short aliases', (t) => {
  const args = parseExtractArgs(argv('-b', 'b1', '-t', '1k', '-p', 'pre', '-s', 'v9'), {});
  t.is(args.bucket, 'b1');
  t.is(args.tier, '1k');
  t.is(args.prefix, 'pre');
  t.is(args.snapshot, 'v9');
});

test('parseExtractArgs rejects an unknown tier', (t) => {
  t.throws(() => parseExtractArgs(argv('-b', 'x', '--tier', '5m'), {}), {
    message: /--tier must be one of/,
  });
});

test('parseExtractArgs defaults to the 1m tier', (t) => {
  t.is(parseExtractArgs(argv('-b', 'x'), {}).tier, '1m');
});

test('parseExtractArgs rejects a non-positive floor', (t) => {
  t.throws(() => parseExtractArgs(argv('-b', 'x', '--floor', '0'), {}), {
    message: /--floor must be a positive integer/,
  });
  t.throws(() => parseExtractArgs(argv('-b', 'x', '--floor', 'abc'), {}), {
    message: /--floor must be a positive integer/,
  });
});

test('parseExtractArgs returns usage for --help without validating', (t) => {
  const args = parseExtractArgs(argv('--help'), {});
  t.true(args.help);
  t.regex(args.usage, /Extract sampled granule bundles/);
});

test('parseFills parses table.column=value', (t) => {
  t.deepEqual(parseFills('collections.metrics_provider=unknown'), {
    'collections.metrics_provider': 'unknown',
  });
});

test('parseFills accepts repeated flags and values containing =', (t) => {
  t.deepEqual(
    parseFills(['collections.metrics_provider=a=b', 'granules.producer_granule_id=x']),
    {
      'collections.metrics_provider': 'a=b',
      'granules.producer_granule_id': 'x',
    }
  );
});

test('parseFills rejects a malformed entry', (t) => {
  t.throws(() => parseFills('nonsense'), { message: /--fill expects table.column=value/ });
  t.throws(() => parseFills('nodot=1'), { message: /--fill key must be table.column/ });
});

test('parseLoadArgs requires bucket, snapshot and tier', (t) => {
  t.throws(() => parseLoadArgs(argv('-s', 'v1', '-t', '10'), {}), { message: /--bucket/ });
  t.throws(() => parseLoadArgs(argv('-b', 'b', '-t', '10'), {}), { message: /--snapshot/ });
  t.throws(() => parseLoadArgs(argv('-b', 'b', '-s', 'v1'), {}), { message: /--tier/ });
});

test('parseLoadArgs parses a full load', (t) => {
  const args = parseLoadArgs(argv(
    '-b', 'bkt', '-s', 'v1-x', '-t', '100', '-e', '5',
    '--fill', 'collections.metrics_provider=m', '--dry-run'
  ), {});

  t.like(args, {
    bucket: 'bkt',
    snapshot: 'v1-x',
    tier: '100',
    executionsPerGranule: 5,
    dryRun: true,
    prefix: 'cumulus',
  });
  t.deepEqual(args.fills, { 'collections.metrics_provider': 'm' });
});

test('parseLoadArgs defaults to two synthetic executions per granule', (t) => {
  t.is(parseLoadArgs(argv('-b', 'b', '-s', 'v', '-t', '10'), {}).executionsPerGranule, 2);
});

test('parseLoadArgs rejects a negative execution count and an unknown tier', (t) => {
  t.throws(() => parseLoadArgs(argv('-b', 'b', '-s', 'v', '-t', '10', '-e', '-1'), {}), {
    message: /--executions-per-granule must be a non-negative integer/,
  });
  t.throws(() => parseLoadArgs(argv('-b', 'b', '-s', 'v', '-t', '7'), {}), {
    message: /--tier must be one of/,
  });
});

test('parseRevertArgs requires a bucket, and an 8-character load id unless listing', (t) => {
  t.throws(() => parseRevertArgs(argv('--list'), {}), { message: /--bucket/ });
  t.throws(() => parseRevertArgs(argv('-b', 'b'), {}), { message: /--load-id is required/ });
  t.throws(() => parseRevertArgs(argv('-b', 'b', '--load-id', 'nope'), {}), {
    message: /8-character/,
  });
  t.like(parseRevertArgs(argv('-b', 'b', '-p', 'pre', '--load-id', 'a1b2c3d4'), {}), {
    bucket: 'b', prefix: 'pre', loadId: 'a1b2c3d4',
  });
  t.true(parseRevertArgs(argv('--list'), { SEED_BUCKET: 'env' }).list);
});
