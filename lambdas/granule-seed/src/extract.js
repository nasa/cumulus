// @ts-check

/* eslint-disable no-await-in-loop */

'use strict';

const Logger = require('@cumulus/logger');

const { withPgClient } = require('./connect');
const { copyQueryToGzipS3 } = require('./copy');
const {
  SEED_TABLES,
  assertTablesPresent,
  introspectTables,
  schemaFingerprint,
} = require('./schema');
const {
  buildTierManifest,
  getTier,
  manifestKey,
  tableKey,
  tiersUpTo,
  writeManifest,
} = require('./bundle');
const {
  buildSampleTable,
  extractionQueries,
  getCollectionStats,
  planAllocation,
} = require('./sample');

const logger = new Logger({ sender: '@cumulus/granule-seed/extract' });

/**
 * Read the source's migration head and partition layout for the manifest.
 *
 * Both migration heads — the source's at extract time and the target's at load time — go
 * into the record so that a refused load can name the migration to look at rather than
 * leaving someone to guess.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<object>}
 */
const describeSource = async (client) => {
  const [version, migrations, partitions] = await Promise.all([
    client.query('SELECT version() AS version, current_database() AS database'),
    client
      .query('SELECT name FROM knex_migrations ORDER BY id DESC LIMIT 1')
      .catch(() => ({ rows: [] })),
    client.query(
      `SELECT parent.relname AS table_name, count(*)::int AS partition_count
         FROM pg_inherits
         JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
        WHERE parent.relname = ANY($1)
        GROUP BY parent.relname`,
      [['granules', 'files', 'executions', 'granules_global_unique', 'files_global_unique']]
    ),
  ]);

  /** @type {Record<string, number>} */
  const partitionCounts = {};
  partitions.rows.forEach((row) => {
    partitionCounts[row.table_name] = Number(row.partition_count);
  });

  return {
    database: version.rows[0].database,
    serverVersion: version.rows[0].version,
    migrationHead: migrations.rows[0]?.name ?? null,
    partitionCounts,
  };
};

/**
 * Extract every tier up to and including `tier` in one pass.
 *
 * The whole run happens inside one `REPEATABLE READ` transaction so that every tier and
 * every table sees a single consistent snapshot; without it, a granule extracted for the
 * 1m tier could be absent from the executions read minutes later, and the bundle's own
 * foreign keys would not close.
 *
 * @param {object} params
 * @param {string} params.bucket
 * @param {string} params.prefix
 * @param {string} params.tier
 * @param {string} params.snapshot
 * @param {number} params.floor
 * @param {string} [params.sourceLabel]
 * @param {boolean} [params.dryRun]
 * @param {NodeJS.ProcessEnv} [params.env]
 * @returns {Promise<object>}
 */
const extract = (params) => {
  const {
    bucket,
    prefix,
    tier: tierName,
    snapshot,
    floor,
    sourceLabel,
    dryRun = false,
    env = process.env,
  } = params;

  const largestTier = getTier(tierName);
  const tiers = tiersUpTo(tierName);

  return withPgClient({ env, applicationName: 'cumulus-granule-seed-extract' },
    async (client) => {
      const introspection = await introspectTables(client, SEED_TABLES);
      assertTablesPresent(introspection, SEED_TABLES);

      const fingerprint = schemaFingerprint(introspection);
      const sourceDescription = await describeSource(client);

      logger.info(`source: ${sourceDescription.database} `
        + `migration head ${sourceDescription.migrationHead ?? 'unknown'}`);
      logger.info(`schema fingerprint ${fingerprint}`);

      // Not READ ONLY: Postgres rejects every CREATE/DROP in a read-only transaction,
      // including the TEMP sample table. The only write is to that temp table, and the
      // transaction is always rolled back. For the same reason this must run against a
      // writer endpoint — a hot-standby reader cannot create temp tables at all.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

      try {
        const collectionStats = await getCollectionStats(client);
        logger.info(`source has ${collectionStats.length} collections with granules`);

        const { allocations, total } = planAllocation({
          budget: largestTier.granules,
          collectionStats,
          floor,
        });

        logger.info(
          `allocated ${total} granules across ${allocations.length} collections `
            + `for the ${largestTier.name} tier; writing tiers `
            + `${tiers.map((t) => t.name).join(', ')}`
        );

        if (total < largestTier.granules) {
          logger.warn(
            `source has only ${total} granules available; the ${largestTier.name} tier `
              + `will hold ${total}, not ${largestTier.granules}`
          );
        }

        const sampling = {
          requestedGranules: largestTier.granules,
          sampledGranules: total,
          collectionFloor: floor,
          collectionCount: allocations.length,
          allocations,
        };

        if (dryRun) {
          logger.info('--dry-run: planned allocation only, nothing written');
          return { dryRun: true, fingerprint, sourceDescription, sampling, tiers };
        }

        const started = Date.now();
        const { rowCount: sampleRows } = await buildSampleTable({
          client,
          allocations,
          onProgress: (done, count) => {
            if (done % 25 === 0 || done === count) {
              logger.info(`sampled ${done}/${count} collections `
                + `(${Math.round((Date.now() - started) / 1000)}s)`);
            }
          },
        });
        logger.info(`sample table holds ${sampleRows} granules`);

        const source = {
          label: sourceLabel ?? sourceDescription.database,
          ...sourceDescription,
          schemaFingerprint: fingerprint,
          extractedAt: new Date().toISOString(),
        };

        /** @type {object[]} */
        const writtenTiers = [];

        for (const [index, tier] of tiers.entries()) {
          const queries = extractionQueries({ introspection, limit: tier.granules });

          /** @type {object[]} */
          const tables = [];

          for (const table of SEED_TABLES) {
            const key = tableKey({ prefix, snapshotVersion: snapshot, tier: tier.name, table });
            const result = await copyQueryToGzipS3({
              client,
              sql: queries[table],
              bucket,
              key,
              onProgress: ({ bytes, lines, seconds }) => logger.info(
                `[${tier.name}] ${table}: still exporting, ${(bytes / 2 ** 20).toFixed(0)} MiB `
                  + `and ~${lines.toLocaleString('en-US')} lines so far, `
                  + `${(bytes / 2 ** 20 / Math.max(seconds, 1)).toFixed(1)} MiB/s over ${seconds}s`
              ),
            });

            logger.info(
              `[${tier.name}] ${table}: ${result.rowCount} rows, `
                + `${result.uncompressedBytes} bytes -> s3://${bucket}/${key}`
            );

            tables.push({
              name: table,
              file: `${table}.csv.gz`,
              columns: introspection[table],
              ...result,
            });
          }

          const manifest = buildTierManifest({
            tier,
            parentTier: index > 0 ? tiers[index - 1].name : undefined,
            source,
            tables,
            sampling,
          });

          // Written last, after every CSV for this tier: a bundle without a manifest is
          // then self-evidently incomplete and the loader refuses it.
          await writeManifest({
            bucket,
            key: manifestKey({ prefix, snapshotVersion: snapshot, tier: tier.name }),
            manifest,
          });

          logger.info(`[${tier.name}] manifest written`);
          writtenTiers.push(manifest);
        }

        await writeManifest({
          bucket,
          key: manifestKey({ prefix, snapshotVersion: snapshot }),
          manifest: {
            bundleFormatVersion: 1,
            snapshotVersion: snapshot,
            createdAt: new Date().toISOString(),
            source,
            sampling,
            tiers: writtenTiers.map((m) => ({
              tier: m.tier,
              stats: m.stats,
              tables: m.tables.map((/** @type {any} */ t) => ({
                name: t.name,
                rowCount: t.rowCount,
                sha256: t.sha256,
              })),
            })),
          },
        });

        return { dryRun: false, fingerprint, source, sampling, tiers: writtenTiers };
      } finally {
        await client.query('ROLLBACK');
      }
    });
};

module.exports = { describeSource, extract };

/* eslint-enable no-await-in-loop */
