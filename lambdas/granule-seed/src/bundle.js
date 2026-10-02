// @ts-check

'use strict';

const {
  getJsonS3Object,
  putJsonS3Object,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');

const { SEED_TABLES } = require('./schema');

const BUNDLE_FORMAT_VERSION = 1;
const MANIFEST_NAME = 'manifest.json';
const ROOT_SEGMENT = 'granule-seed';

/**
 * The tier ladder. `granules` is the unit — a tier named `1m` holds one million granule
 * rows, and its file count is whatever the source's files-per-granule ratio yields, which
 * the manifest records rather than assumes.
 *
 * Tiers are nested: every tier is a strict prefix of the next, so a 1k run and a 1m run
 * are the same dataset at two sizes. That is what makes benchmark results comparable, and
 * it is why the smaller tiers are free to produce.
 */
const TIERS = Object.freeze([
  Object.freeze({ name: '10', granules: 10 }),
  Object.freeze({ name: '100', granules: 100 }),
  Object.freeze({ name: '1k', granules: 1000 }),
  Object.freeze({ name: '10k', granules: 10_000 }),
  Object.freeze({ name: '100k', granules: 100_000 }),
  Object.freeze({ name: '1m', granules: 1_000_000 }),
]);

/**
 * @param {string} name
 * @returns {{name: string, granules: number}}
 */
const getTier = (name) => {
  const tier = TIERS.find((t) => t.name === name);
  if (!tier) {
    throw new Error(
      `Unknown tier "${name}". Valid tiers: ${TIERS.map((t) => t.name).join(', ')}`
    );
  }
  return tier;
};

/**
 * Tiers at or below `name`, smallest first. Used to write every nested tier from one
 * sample in a single extraction run.
 *
 * @param {string} name
 * @returns {{name: string, granules: number}[]}
 */
const tiersUpTo = (name) => {
  const tier = getTier(name);
  return TIERS.filter((t) => t.granules <= tier.granules);
};

/**
 * @param {object} params
 * @param {string} params.prefix - S3 key prefix, e.g. a stack name
 * @param {string} params.snapshotVersion
 * @param {string} [params.tier]
 * @returns {string}
 */
const bundleKeyPrefix = ({ prefix, snapshotVersion, tier }) => {
  const segments = [prefix, ROOT_SEGMENT, `v${BUNDLE_FORMAT_VERSION}`, snapshotVersion];
  if (tier) segments.push(tier);
  return segments.filter((s) => s !== '' && s !== undefined).join('/');
};

/**
 * @param {object} params
 * @param {string} params.prefix
 * @param {string} params.snapshotVersion
 * @param {string} params.tier
 * @param {string} params.table
 * @returns {string}
 */
const tableKey = ({ prefix, snapshotVersion, tier, table }) =>
  `${bundleKeyPrefix({ prefix, snapshotVersion, tier })}/${table}.csv.gz`;

/**
 * @param {object} params
 * @param {string} params.prefix
 * @param {string} params.snapshotVersion
 * @param {string} [params.tier]
 * @returns {string}
 */
const manifestKey = (params) => `${bundleKeyPrefix(params)}/${MANIFEST_NAME}`;

/**
 * Write a tier manifest.
 *
 * Callers must write this *last*, after every CSV for the tier has uploaded, so that a
 * bundle missing its manifest is self-evidently incomplete and the loader can refuse it.
 * An SSH drop partway through an extraction otherwise leaves a bundle that looks whole.
 *
 * @param {object} params
 * @param {string} params.bucket
 * @param {string} params.key
 * @param {object} params.manifest
 * @returns {Promise<void>}
 */
const writeManifest = async ({ bucket, key, manifest }) => {
  await putJsonS3Object(bucket, key, manifest);
};

/**
 * @param {object} params
 * @param {string} params.bucket
 * @param {string} params.key
 * @returns {Promise<any>}
 */
const readManifest = async ({ bucket, key }) => {
  const exists = await s3ObjectExists({ Bucket: bucket, Key: key });
  if (!exists) {
    throw new Error(
      `No manifest at s3://${bucket}/${key}. The bundle is incomplete or the tier does `
        + 'not exist; manifests are written last, so a missing one means the extraction '
        + 'did not finish.'
    );
  }
  return getJsonS3Object(bucket, key);
};

/**
 * @typedef {object} TableManifestEntry
 * @property {string} name
 * @property {string} file
 * @property {import('./schema').ColumnDef[]} columns
 * @property {number} rowCount
 * @property {string} sha256
 * @property {number} uncompressedBytes
 */

/**
 * Assemble a tier manifest.
 *
 * `columns` carries the full introspected column definitions rather than just names,
 * because the loader negotiates on type and nullability as well as presence.
 *
 * @param {object} params
 * @param {{name: string, granules: number}} params.tier
 * @param {string|undefined} params.parentTier
 * @param {object} params.source
 * @param {TableManifestEntry[]} params.tables
 * @param {object} [params.sampling]
 * @returns {object}
 */
const buildTierManifest = ({ tier, parentTier, source, tables, sampling }) => {
  const granuleEntry = tables.find((t) => t.name === 'granules');
  const fileEntry = tables.find((t) => t.name === 'files');

  const granuleCount = granuleEntry?.rowCount ?? 0;
  const fileCount = fileEntry?.rowCount ?? 0;

  return {
    bundleFormatVersion: BUNDLE_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    tier: tier.name,
    requestedGranules: tier.granules,
    parentTier,
    source,
    sampling,
    stats: {
      granuleCount,
      fileCount,
      // Recorded rather than assumed: files dominate both bundle size and load time, so
      // sizing every other tier depends on the real ratio.
      filesPerGranule: granuleCount > 0 ? fileCount / granuleCount : 0,
    },
    tables,
  };
};

/**
 * Sanity-check a manifest before the loader acts on it.
 *
 * @param {any} manifest
 * @returns {void}
 */
const assertManifestUsable = (manifest) => {
  if (manifest?.bundleFormatVersion !== BUNDLE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported bundleFormatVersion ${manifest?.bundleFormatVersion}; `
        + `this tool reads version ${BUNDLE_FORMAT_VERSION}.`
    );
  }

  const present = new Set((manifest.tables ?? []).map((/** @type {any} */ t) => t.name));
  const missing = SEED_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new Error(`Manifest is missing table entries: ${missing.join(', ')}`);
  }
};

module.exports = {
  BUNDLE_FORMAT_VERSION,
  MANIFEST_NAME,
  TIERS,
  assertManifestUsable,
  buildTierManifest,
  bundleKeyPrefix,
  getTier,
  manifestKey,
  readManifest,
  tableKey,
  tiersUpTo,
  writeManifest,
};
