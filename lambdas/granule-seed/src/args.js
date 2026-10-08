// @ts-check

'use strict';

const minimist = require('minimist');

const { TIERS } = require('./bundle');

/**
 * Default snapshot version: `v1-YYYY-MM-DD`. Stable within a day so that a re-run after a
 * failure writes to the same prefix rather than orphaning a partial bundle.
 *
 * @param {Date} [now]
 * @returns {string}
 */
const defaultSnapshotVersion = (now = new Date()) =>
  `v1-${now.toISOString().slice(0, 10)}`;

/**
 * Parse `--fill table.column=value` into a lookup. Repeatable.
 *
 * @param {string | string[] | undefined} raw
 * @returns {Record<string, string>}
 */
const parseFills = (raw) => {
  if (raw === undefined) return {};
  const entries = Array.isArray(raw) ? raw : [raw];

  /** @type {Record<string, string>} */
  const fills = {};
  entries.forEach((entry) => {
    const separator = entry.indexOf('=');
    if (separator < 1) {
      throw new Error(`--fill expects table.column=value, got "${entry}"`);
    }
    const key = entry.slice(0, separator);
    if (!key.includes('.')) {
      throw new Error(`--fill key must be table.column, got "${key}"`);
    }
    fills[key] = entry.slice(separator + 1);
  });

  return fills;
};

const EXTRACT_USAGE = `
Extract sampled granule bundles from a Cumulus database to S3.

Usage: node bin/extract.js --bucket <bucket> [options]

Options:
  -b, --bucket <name>      S3 bucket for the bundles                  [required]
  -p, --prefix <prefix>    S3 key prefix                       [default: cumulus]
  -t, --tier <tier>        Largest tier to write; every smaller tier is written
                           too, as a prefix of it    [default: 1m] (${TIERS.map((x) => x.name).join('|')})
  -s, --snapshot <version> Snapshot version segment    [default: v1-<today>]
      --floor <n>          Minimum granules per collection, when the budget allows
                                                                   [default: 1]
      --source-label <s>   Source cluster label recorded in the manifest
  -n, --dry-run            Plan and report, write nothing to S3
      --local              Target a local unsecured Postgres (sets DISABLE_PG_SSL)
  -h, --help               Show this message

Connection comes from @cumulus/db: databaseCredentialSecretArn if set, otherwise
PG_HOST / PG_USER / PG_PASSWORD / PG_DATABASE / PG_PORT.
`;

/**
 * Parse extractor arguments.
 *
 * Follows the repo's existing convention (see scripts/generate_records): every flag has a
 * short alias and an environment-variable fallback supplied as its default, so the CLI
 * wins over the environment.
 *
 * @param {string[]} [argv] - defaults to `process.argv`, which minimist is given whole
 *   here for consistency with the sibling scripts
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {object}
 */
const parseExtractArgs = (argv = process.argv, env = process.env) => {
  const parsed = minimist(argv.slice(2), {
    string: ['bucket', 'prefix', 'tier', 'snapshot', 'floor', 'source-label'],
    boolean: ['dry-run', 'local', 'help'],
    alias: {
      b: 'bucket',
      p: 'prefix',
      t: 'tier',
      s: 'snapshot',
      n: 'dry-run',
      h: 'help',
    },
    default: {
      bucket: env.SEED_BUCKET,
      prefix: env.SEED_PREFIX ?? 'cumulus',
      tier: env.SEED_TIER ?? '1m',
      snapshot: env.SEED_SNAPSHOT ?? defaultSnapshotVersion(),
      floor: env.SEED_COLLECTION_FLOOR ?? '1',
      'source-label': env.SEED_SOURCE_LABEL,
      'dry-run': false,
      local: false,
      help: false,
    },
  });

  if (parsed.help) return { help: true, usage: EXTRACT_USAGE };

  const tierNames = TIERS.map((t) => t.name);
  if (!tierNames.includes(parsed.tier)) {
    throw new Error(
      `--tier must be one of ${tierNames.join(', ')} (got "${parsed.tier}")`
    );
  }

  if (!parsed['dry-run'] && !parsed.bucket) {
    throw new Error('--bucket (or SEED_BUCKET) is required unless --dry-run is set');
  }

  const floor = Number.parseInt(parsed.floor, 10);
  if (!Number.isInteger(floor) || floor < 1) {
    throw new Error(`--floor must be a positive integer (got "${parsed.floor}")`);
  }

  return {
    help: false,
    bucket: parsed.bucket,
    prefix: parsed.prefix,
    tier: parsed.tier,
    snapshot: parsed.snapshot,
    floor,
    sourceLabel: parsed['source-label'],
    dryRun: parsed['dry-run'],
    local: parsed.local,
  };
};

const LOAD_USAGE = `
Load one tier of a granule bundle from S3 into a Cumulus database.

Usage: node bin/load.js --bucket <b> --snapshot <version> --tier <tier> [options]

Options:
  -b, --bucket <name>      S3 bucket holding the bundle                 [required]
  -p, --prefix <prefix>    S3 key prefix                       [default: cumulus]
  -s, --snapshot <version> Snapshot version, e.g. v1-2026-09-23          [required]
  -t, --tier <tier>        Tier to load (${TIERS.map((x) => x.name).join('|')})    [required]
  -e, --executions-per-granule <n>
                           Synthetic executions generated per loaded granule, linked
                           through granules_executions                [default: 2]
      --fill t.col=value   Value for a target NOT NULL column the bundle lacks
                           (repeatable)
  -n, --dry-run            Stage and check for collisions, then discard; loads nothing
      --local              Target a local unsecured Postgres (sets DISABLE_PG_SSL)
  -h, --help               Show this message

A database holds one load of a given dataset at a time. To load a larger tier,
revert the current load first (bin/revert.js). Each load's record, which revert
uses, is written to s3://<bucket>/<prefix>/granule-seed/loads/<loadId>.json.
`;

/**
 * @param {string[]} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {object}
 */
const parseLoadArgs = (argv = process.argv, env = process.env) => {
  const parsed = minimist(argv.slice(2), {
    string: ['bucket', 'prefix', 'tier', 'snapshot', 'fill', 'executions-per-granule'],
    boolean: ['dry-run', 'local', 'help'],
    alias: {
      b: 'bucket',
      p: 'prefix',
      t: 'tier',
      s: 'snapshot',
      e: 'executions-per-granule',
      n: 'dry-run',
      h: 'help',
    },
    default: {
      bucket: env.SEED_BUCKET,
      prefix: env.SEED_PREFIX ?? 'cumulus',
      tier: env.SEED_TIER,
      snapshot: env.SEED_SNAPSHOT,
      'executions-per-granule': env.SEED_EXECUTIONS_PER_GRANULE ?? '2',
      'dry-run': false,
      local: false,
      help: false,
    },
  });

  if (parsed.help) return { help: true, usage: LOAD_USAGE };

  ['bucket', 'snapshot', 'tier'].forEach((flag) => {
    if (!parsed[flag]) throw new Error(`--${flag} is required`);
  });

  const tierNames = TIERS.map((t) => t.name);
  if (!tierNames.includes(parsed.tier)) {
    throw new Error(`--tier must be one of ${tierNames.join(', ')} (got "${parsed.tier}")`);
  }

  const executionsPerGranule = Number.parseInt(parsed['executions-per-granule'], 10);
  if (!Number.isInteger(executionsPerGranule) || executionsPerGranule < 0) {
    throw new Error('--executions-per-granule must be a non-negative integer '
      + `(got "${parsed['executions-per-granule']}")`);
  }

  return {
    help: false,
    bucket: parsed.bucket,
    prefix: parsed.prefix,
    snapshot: parsed.snapshot,
    executionsPerGranule,
    tier: parsed.tier,
    fills: parseFills(parsed.fill),
    dryRun: parsed['dry-run'],
    local: parsed.local,
  };
};

const REVERT_USAGE = `
Remove everything a granule-seed load inserted.

Usage: node bin/revert.js --bucket <b> --prefix <p> --load-id <id> [--local]
       node bin/revert.js --bucket <b> --prefix <p> --list

The load's record is read from s3://<bucket>/<prefix>/granule-seed/loads/. Revert
refuses to run against a database other than the one the load went into.
Only rows the load created are deleted; collections, providers, async operations and
rules that already existed in the database are left alone.
`;

/**
 * @param {string[]} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {object}
 */
const parseRevertArgs = (argv = process.argv, env = process.env) => {
  const parsed = minimist(argv.slice(2), {
    string: ['load-id', 'bucket', 'prefix'],
    boolean: ['list', 'local', 'help'],
    alias: { b: 'bucket', p: 'prefix', h: 'help' },
    default: {
      bucket: env.SEED_BUCKET,
      prefix: env.SEED_PREFIX ?? 'cumulus',
      list: false,
      local: false,
      help: false,
    },
  });

  if (parsed.help) return { help: true, usage: REVERT_USAGE };
  if (!parsed.bucket) throw new Error('--bucket (or SEED_BUCKET) is required');
  if (!parsed.list && !parsed['load-id']) {
    throw new Error('--load-id is required unless --list is set');
  }
  if (parsed['load-id'] && !/^[\da-f]{8}$/.test(parsed['load-id'])) {
    throw new Error('--load-id must be the 8-character id a load printed '
      + `(got "${parsed['load-id']}")`);
  }

  return {
    help: false,
    bucket: parsed.bucket,
    prefix: parsed.prefix,
    list: parsed.list,
    loadId: parsed['load-id'],
    local: parsed.local,
  };
};

module.exports = {
  EXTRACT_USAGE,
  LOAD_USAGE,
  REVERT_USAGE,
  defaultSnapshotVersion,
  parseExtractArgs,
  parseFills,
  parseLoadArgs,
  parseRevertArgs,
};
