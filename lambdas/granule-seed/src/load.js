// @ts-check

/* eslint-disable no-await-in-loop */

'use strict';

const crypto = require('crypto');
const Logger = require('@cumulus/logger');

const { version: TOOL_VERSION } = require('../package.json');

const { withPgClient } = require('./connect');
const { copyGzipS3ToTable } = require('./copy');
const {
  SEED_TABLES,
  assertTablesPresent,
  introspectTables,
  negotiate,
  schemaFingerprint,
} = require('./schema');
const { assertManifestUsable, manifestKey, readManifest, tableKey } = require('./bundle');
const { recordKey, writeRecord } = require('./record');

const logger = new Logger({ sender: '@cumulus/granule-seed/load' });

/**
 * Dimension tables are matched on their natural key and reused when the target already
 * has the row; only rows the load creates are removed on revert.
 */
const NATURAL_KEYS = Object.freeze({
  collections: ['name', 'version'],
  providers: ['name'],
  async_operations: ['id'],
  rules: ['name'],
});

/**
 * Staging tables are TEMP tables: they live in the session's private schema and Postgres
 * removes them when the connection closes. The loader never issues DROP or TRUNCATE, which
 * some targets (CC SIT, with pglogical) refuse for the Cumulus user.
 *
 * @param {string} loadId
 * @param {string} table
 * @returns {string}
 */
const stagingTable = (loadId, table) => `granule_seed_${loadId}_${table}`;

/**
 * @param {string} identifier
 * @returns {string}
 */
const quoteIdent = (identifier) => `"${identifier.replace(/"/g, '""')}"`;

/**
 * Stage one table: a TEMP copy of the bundle's columns, typed exactly as the target's own
 * columns (CTAS from the target), plus the columns the remapping needs. CTAS copies
 * types but not NOT NULL, defaults, keys or triggers, which is what a staging table wants.
 *
 * @param {object} params
 * @param {import('pg').Client} params.client
 * @param {string} params.loadId
 * @param {string} params.table
 * @param {string[]} params.columns
 * @param {string} params.bucket
 * @param {string} params.key
 * @returns {Promise<number>} rows staged
 */
const stageTable = async ({ client, loadId, table, columns, bucket, key }) => {
  const stg = stagingTable(loadId, table);
  const columnList = columns.map(quoteIdent).join(', ');

  await client.query(
    `CREATE TEMP TABLE ${stg} AS SELECT ${columnList} FROM ${table} WITH NO DATA`
  );
  await client.query(
    `ALTER TABLE ${stg}
       ADD COLUMN seed_tgt_id BIGINT,
       ADD COLUMN seed_tgt_collection_id INTEGER,
       ADD COLUMN seed_created BOOLEAN NOT NULL DEFAULT true`
  );

  const { rowCount } = await copyGzipS3ToTable({ client, bucket, key, table: stg, columns });

  if (columns.includes('cumulus_id')) {
    await client.query(`CREATE INDEX ON ${stg} (cumulus_id)`);
  }
  await client.query(`ANALYZE ${stg}`);

  return rowCount;
};

/**
 * Collisions on anything the target enforces as unique across the database. A collision
 * means this data, or data with the same identifiers, is already loaded; the load aborts
 * before writing so that nothing is half-inserted.
 *
 * @param {import('pg').Client} client
 * @param {string} loadId
 * @returns {Promise<string[]>} human-readable collision descriptions
 */
const findCollisions = async (client, loadId) => {
  const checks = [
    {
      what: 'granule_id',
      sql: `SELECT s.granule_id AS v FROM ${stagingTable(loadId, 'granules')} s
             JOIN granules_global_unique u ON u.granule_id = s.granule_id`,
    },
    {
      what: 'file bucket/key',
      sql: `SELECT s.bucket || '/' || s.key AS v FROM ${stagingTable(loadId, 'files')} s
             JOIN files_global_unique u ON u.bucket = s.bucket AND u.key = s.key`,
    },
    {
      what: 'execution arn',
      sql: `SELECT s.arn AS v FROM ${stagingTable(loadId, 'executions')} s
             JOIN executions_global_unique u ON u.arn = s.arn`,
    },
    {
      what: 'execution url',
      sql: `SELECT s.url AS v FROM ${stagingTable(loadId, 'executions')} s
             JOIN executions_global_unique u ON u.url = s.url`,
    },
    {
      what: 'pdr name',
      sql: `SELECT s.name AS v FROM ${stagingTable(loadId, 'pdrs')} s
             JOIN pdrs t ON t.name = s.name`,
    },
  ];

  /** @type {string[]} */
  const collisions = [];
  for (const check of checks) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n, (array_agg(v))[1:3] AS examples FROM (${check.sql}) c`
    );
    if (rows[0].n > 0) {
      collisions.push(`${rows[0].n} ${check.what}(s) already exist, e.g. `
        + `${rows[0].examples.join(', ')}`);
    }
  }
  return collisions;
};

/**
 * Give every staged row that still needs one a new id from the target table's own
 * sequence, in source id order so relative ordering (and cumulus_id pagination) matches
 * the source. Using the sequence means no `setval` is ever needed and concurrent ingest
 * cannot collide with seeded ids.
 *
 * @param {import('pg').Client} client
 * @param {string} loadId
 * @param {string} table
 * @returns {Promise<void>}
 */
const allocateIds = async (client, loadId, table) => {
  const stg = stagingTable(loadId, table);
  const { rows } = await client.query(
    'SELECT pg_get_serial_sequence($1, \'cumulus_id\') AS seq',
    [`public.${table}`]
  );
  const sequence = rows[0].seq;
  if (!sequence) throw new Error(`No cumulus_id sequence found for ${table}`);

  await client.query(
    `UPDATE ${stg} s
        SET seed_tgt_id = a.id
       FROM (
         SELECT o.cumulus_id AS src, nextval(${client.escapeLiteral(sequence)}) AS id
           FROM (SELECT cumulus_id FROM ${stg}
                  WHERE seed_tgt_id IS NULL ORDER BY cumulus_id) o
       ) a
      WHERE s.cumulus_id = a.src
        AND s.seed_tgt_id IS NULL`
  );
};

/**
 * Point staged dimension rows at existing target rows with the same natural key, and mark
 * them reused rather than created.
 *
 * @param {import('pg').Client} client
 * @param {string} loadId
 * @param {string} table
 * @returns {Promise<void>}
 */
const matchExisting = async (client, loadId, table) => {
  const keys = NATURAL_KEYS[table];
  const on = keys.map((k) => `t.${quoteIdent(k)} = s.${quoteIdent(k)}`).join(' AND ');
  await client.query(
    `UPDATE ${stagingTable(loadId, table)} s
        SET seed_tgt_id = t.cumulus_id, seed_created = false
       FROM ${table} t
      WHERE ${on}`
  );
};

/**
 * Build and run `INSERT INTO table (...) SELECT ... FROM staging s <joins>`.
 *
 * Every column is copied from staging unless `overrides` supplies an expression, which is
 * how foreign keys are remapped. `cumulus_id` always becomes the allocated target id.
 *
 * @param {object} params
 * @param {import('pg').Client} params.client
 * @param {string} params.loadId
 * @param {string} params.table
 * @param {import('./schema').TableNegotiation} params.negotiation
 * @param {import('./schema').ColumnDef[]} params.targetColumns
 * @param {Record<string, string>} params.fills
 * @param {Record<string, string>} [params.overrides]
 * @param {string} [params.joins]
 * @param {string} [params.where]
 * @returns {Promise<number>}
 */
const insertFromStaging = async ({
  client, loadId, table, negotiation, targetColumns, fills,
  overrides = {}, joins = '', where = '',
}) => {
  const columns = [...negotiation.copyColumns];
  const expressions = columns.map((column) => {
    if (column === 'cumulus_id') return 's.seed_tgt_id';
    return overrides[column] ?? `s.${quoteIdent(column)}`;
  });

  negotiation.filled.forEach((column) => {
    const def = targetColumns.find((c) => c.column === column);
    columns.push(column);
    expressions.push(
      `${client.escapeLiteral(fills[`${table}.${column}`])}::${def ? def.udtName : 'text'}`
    );
  });

  const { rowCount } = await client.query(
    `INSERT INTO ${table} (${columns.map(quoteIdent).join(', ')})
     SELECT ${expressions.join(', ')}
       FROM ${stagingTable(loadId, table)} s
       ${joins}
       ${where ? `WHERE ${where}` : ''}`
  );
  return rowCount ?? 0;
};

/**
 * Remapping, per table: which columns become which target ids, through which staging map.
 * Collection ids in `files` and `granules_executions` come from the *granule* map, never
 * from the bundle's value — they are half of a composite FK to granules.
 *
 * @param {string} loadId
 * @returns {Record<string, {overrides: Record<string, string>, joins: string,
 *   where?: string}>}
 */
const remapPlan = (loadId) => {
  const stg = (table) => stagingTable(loadId, table);
  return {
    collections: { overrides: {}, joins: '', where: 's.seed_created' },
    providers: { overrides: {}, joins: '', where: 's.seed_created' },
    async_operations: { overrides: {}, joins: '', where: 's.seed_created' },
    rules: {
      overrides: {
        collection_cumulus_id: 'c.seed_tgt_id',
        provider_cumulus_id: 'p.seed_tgt_id',
      },
      joins: `LEFT JOIN ${stg('collections')} c ON c.cumulus_id = s.collection_cumulus_id
              LEFT JOIN ${stg('providers')} p ON p.cumulus_id = s.provider_cumulus_id`,
      where: 's.seed_created',
    },
    executions: {
      overrides: {
        collection_cumulus_id: 'c.seed_tgt_id',
        async_operation_cumulus_id: 'a.seed_tgt_id',
        parent_cumulus_id: 'parent.seed_tgt_id',
        parent_created_at: 'parent.created_at',
      },
      joins: `LEFT JOIN ${stg('collections')} c ON c.cumulus_id = s.collection_cumulus_id
              LEFT JOIN ${stg('async_operations')} a
                     ON a.cumulus_id = s.async_operation_cumulus_id
              LEFT JOIN ${stg('executions')} parent
                     ON parent.cumulus_id = s.parent_cumulus_id
                    AND parent.created_at = s.parent_created_at`,
    },
    pdrs: {
      overrides: {
        collection_cumulus_id: 'c.seed_tgt_id',
        provider_cumulus_id: 'p.seed_tgt_id',
        execution_cumulus_id: 'e.seed_tgt_id',
        execution_created_at: 'e.created_at',
      },
      joins: `JOIN ${stg('collections')} c ON c.cumulus_id = s.collection_cumulus_id
              JOIN ${stg('providers')} p ON p.cumulus_id = s.provider_cumulus_id
              LEFT JOIN ${stg('executions')} e
                     ON e.cumulus_id = s.execution_cumulus_id
                    AND e.created_at = s.execution_created_at`,
    },
    granules: {
      overrides: {
        collection_cumulus_id: 's.seed_tgt_collection_id',
        pdr_cumulus_id: 'pd.seed_tgt_id',
        provider_cumulus_id: 'p.seed_tgt_id',
      },
      joins: `LEFT JOIN ${stg('pdrs')} pd ON pd.cumulus_id = s.pdr_cumulus_id
              LEFT JOIN ${stg('providers')} p ON p.cumulus_id = s.provider_cumulus_id`,
    },
    files: {
      overrides: {
        granule_cumulus_id: 'g.seed_tgt_id',
        collection_cumulus_id: 'g.seed_tgt_collection_id',
      },
      joins: `JOIN ${stg('granules')} g
                ON g.cumulus_id = s.granule_cumulus_id
               AND g.collection_cumulus_id = s.collection_cumulus_id`,
    },
    granules_executions: {
      overrides: {
        granule_cumulus_id: 'g.seed_tgt_id',
        collection_cumulus_id: 'g.seed_tgt_collection_id',
        execution_cumulus_id: 'e.seed_tgt_id',
      },
      joins: `JOIN ${stg('granules')} g
                ON g.cumulus_id = s.granule_cumulus_id
               AND g.collection_cumulus_id = s.collection_cumulus_id
              JOIN ${stg('executions')} e
                ON e.cumulus_id = s.execution_cumulus_id
               AND e.created_at = s.execution_created_at`,
    },
  };
};

/**
 * Add synthetic executions for the staged granules, `perGranule` each, linked through
 * `granules_executions`.
 *
 * They are written into *staging*, before the insert phase, so they are remapped,
 * inserted in the same transaction and removed by revert exactly like bundle rows. Their
 * source ids are negative, so they can never collide with a bundle execution's id.
 *
 * Values are derived from a hash of the granule id, so a re-run generates the same rows.
 * `created_at` falls in the last 180 days, which puts the rows in the real quarterly
 * partitions rather than `executions_default`. ARNs name the dummy account 000000000000,
 * so nothing that follows one reaches a real Step Functions execution.
 *
 * @param {object} params
 * @param {import('pg').Client} params.client
 * @param {string} params.loadId
 * @param {number} params.perGranule
 * @param {string[]} params.executionColumns - columns present in the executions staging
 * @returns {Promise<number>} executions generated
 */
const synthesizeExecutions = async ({ client, loadId, perGranule, executionColumns }) => {
  if (perGranule <= 0) return 0;

  const stgExecutions = stagingTable(loadId, 'executions');
  const stgGranules = stagingTable(loadId, 'granules');
  const stgLinks = stagingTable(loadId, 'granules_executions');

  await client.query(
    `ALTER TABLE ${stgExecutions}
       ADD COLUMN IF NOT EXISTS seed_granule_id BIGINT,
       ADD COLUMN IF NOT EXISTS seed_granule_collection_id INTEGER`
  );

  // h: a stable 0..2^31 pseudo-random value per (granule, n).
  const values = {
    cumulus_id: '-(row_number() OVER (ORDER BY g.cumulus_id, n.n))',
    arn: `'arn:aws:states:us-west-2:000000000000:execution:granule-seed-'
           || workflow || ':' || md5(g.granule_id || ':' || n.n)`,
    url: `'https://console.aws.amazon.com/states/home?region=us-west-2#/executions/details/'
           || 'arn:aws:states:us-west-2:000000000000:execution:granule-seed-'
           || workflow || ':' || md5(g.granule_id || ':' || n.n)`,
    status: `CASE WHEN h % 100 < 85 THEN 'completed'
                  WHEN h % 100 < 97 THEN 'failed' ELSE 'running' END`,
    workflow_name: 'workflow',
    collection_cumulus_id: 'g.collection_cumulus_id',
    cumulus_version: client.escapeLiteral(TOOL_VERSION),
    error: `CASE WHEN h % 100 >= 85 AND h % 100 < 97 THEN
              jsonb_build_object('Error', 'CumulusMessageAdapterExecutionError',
                                 'Cause', 'granule-seed synthetic failure') END`,
    duration: '(h % 600) + 5',
    original_payload: `jsonb_build_object('granules',
                         jsonb_build_array(jsonb_build_object('granuleId', g.granule_id)))`,
    final_payload: `CASE WHEN h % 100 < 85 THEN jsonb_build_object('granules',
                      jsonb_build_array(jsonb_build_object('granuleId', g.granule_id,
                                                           'status', 'completed'))) END`,
    created_at: 'created',
    updated_at: 'created + ((h % 600) + 5) * interval \'1 second\'',
    timestamp: 'created + ((h % 600) + 5) * interval \'1 second\'',
    archived: 'false',
    seed_granule_id: 'g.cumulus_id',
    seed_granule_collection_id: 'g.collection_cumulus_id',
  };

  const columns = Object.keys(values)
    .filter((c) => executionColumns.includes(c) || c.startsWith('seed_'));

  const { rowCount } = await client.query(
    `INSERT INTO ${stgExecutions} (${columns.map(quoteIdent).join(', ')})
     SELECT ${columns.map((c) => values[c]).join(', ')}
       FROM ${stgGranules} g
      CROSS JOIN generate_series(1, $1::int) AS n(n)
      CROSS JOIN LATERAL (
        SELECT (hashtext(g.granule_id || ':' || n.n)::bigint & 2147483647) AS h
      ) hv
      CROSS JOIN LATERAL (
        SELECT CASE WHEN n.n % 2 = 1 THEN 'IngestGranule' ELSE 'PublishGranule' END
                 AS workflow,
               date_trunc('milliseconds',
                 now() - (hv.h % (180 * 24 * 3600)) * interval '1 second') AS created
      ) derived`,
    [perGranule]
  );

  await client.query(
    `INSERT INTO ${stgLinks}
       (granule_cumulus_id, collection_cumulus_id, execution_cumulus_id, execution_created_at)
     SELECT seed_granule_id, seed_granule_collection_id, cumulus_id, created_at
       FROM ${stgExecutions}
      WHERE seed_granule_id IS NOT NULL`
  );

  return rowCount ?? 0;
};

/**
 * The target ids a load inserted: everything revert needs. Ids are kept as strings (pg
 * returns BIGINT as text) and execution timestamps as Postgres text, which casts back to
 * exactly the same timestamptz — the executions primary key includes created_at.
 *
 * @param {import('pg').Client} client
 * @param {string} loadId
 * @returns {Promise<Record<string, any[]>>}
 */
const collectInsertedIds = async (client, loadId) => {
  const stg = (table) => stagingTable(loadId, table);
  const rows = async (sql) => (await client.query({ text: sql, rowMode: 'array' })).rows;

  const created = async (table) => (await rows(
    `SELECT seed_tgt_id::text FROM ${stg(table)} WHERE seed_created ORDER BY 1`
  )).map(([id]) => id);

  return {
    granules: await rows(
      `SELECT seed_tgt_id::text, seed_tgt_collection_id::text FROM ${stg('granules')}
        ORDER BY seed_tgt_id`
    ),
    executions: await rows(
      `SELECT seed_tgt_id::text, created_at::text FROM ${stg('executions')}
        ORDER BY seed_tgt_id`
    ),
    pdrs: (await rows(`SELECT seed_tgt_id::text FROM ${stg('pdrs')} ORDER BY 1`))
      .map(([id]) => id),
    rules: await created('rules'),
    async_operations: await created('async_operations'),
    providers: await created('providers'),
    collections: await created('collections'),
  };
};

/**
 * Load one tier of a bundle into the connected database.
 *
 * All inserts happen in one transaction: a failure leaves the target exactly as it was.
 * Before committing, the load writes a record of every id it inserted to S3 under
 * `<prefix>/granule-seed/loads/`; revert works from that record. Nothing else is left in
 * the target: the staging tables are TEMP tables and disappear with the connection.
 *
 * @param {object} params
 * @param {string} params.bucket
 * @param {string} params.prefix
 * @param {string} params.snapshot
 * @param {string} params.tier
 * @param {Record<string, string>} [params.fills]
 * @param {number} [params.executionsPerGranule] - synthetic executions per granule
 * @param {boolean} [params.dryRun]
 * @param {string} [params.loadId]
 * @param {NodeJS.ProcessEnv} [params.env]
 * @returns {Promise<object>}
 */
const load = (params) => {
  const {
    bucket, prefix, snapshot, tier, fills = {}, dryRun = false, env = process.env,
    executionsPerGranule = 2,
    loadId = crypto.randomBytes(4).toString('hex'),
  } = params;

  const location = { prefix, snapshotVersion: snapshot, tier };
  const bundleUri = `s3://${bucket}/${manifestKey(location)}`;

  return withPgClient({ env, applicationName: 'cumulus-granule-seed-load' }, async (client) => {
    const manifest = await readManifest({ bucket, key: manifestKey(location) });
    assertManifestUsable(manifest);

    const targetIntrospection = await introspectTables(client, SEED_TABLES);
    assertTablesPresent(targetIntrospection, SEED_TABLES);

    /** @type {Record<string, import('./schema').ColumnDef[]>} */
    const bundleTables = {};
    manifest.tables.forEach((/** @type {any} */ entry) => {
      bundleTables[entry.name] = entry.columns;
    });
    const negotiation = negotiate({ bundleTables, targetIntrospection, fills });

    const targetFingerprint = schemaFingerprint(targetIntrospection);
    if (targetFingerprint !== manifest.source.schemaFingerprint) {
      logger.warn(`target schema fingerprint ${targetFingerprint} differs from the source's `
        + `${manifest.source.schemaFingerprint}; columns were negotiated by name`);
    }

    const { rows: dbRows } = await client.query('SELECT current_database() AS database');
    const record = {
      loadId,
      status: 'started',
      bundleUri,
      tier,
      snapshot,
      target: { database: dbRows[0].database },
      executionsPerGranule,
      startedAt: new Date().toISOString(),
    };

    /** @type {Record<string, number>} */
    const staged = {};
    for (const table of SEED_TABLES) {
      staged[table] = await stageTable({
        client,
        loadId,
        table,
        columns: negotiation[table].copyColumns,
        bucket,
        key: tableKey({ ...location, table }),
      });
      logger.info(`[${loadId}] staged ${table}: ${staged[table]} rows`);
    }

    const synthesizedExecutions = await synthesizeExecutions({
      client,
      loadId,
      perGranule: executionsPerGranule,
      executionColumns: negotiation.executions.copyColumns,
    });
    if (synthesizedExecutions > 0) {
      logger.info(`[${loadId}] generated ${synthesizedExecutions} synthetic executions`);
    }

    const collisions = await findCollisions(client, loadId);
    if (collisions.length > 0) {
      throw new Error(
        'Target already holds rows with the same unique identifiers, so nothing was '
          + 'loaded. Revert the earlier load of this data first (bin/revert.js --list):\n  - '
          + collisions.join('\n  - ')
      );
    }

    if (dryRun) {
      // The staging tables are TEMP and go when this connection closes.
      return { dryRun: true, loadId, staged, synthesizedExecutions, bundleUri };
    }

    const plan = remapPlan(loadId);
    /** @type {Record<string, number>} */
    const inserted = {};

    await client.query('BEGIN');
    try {
      for (const table of SEED_TABLES) {
        if (NATURAL_KEYS[table]) await matchExisting(client, loadId, table);
        if (table !== 'granules_executions') await allocateIds(client, loadId, table);

        if (table === 'granules') {
          await client.query(
            `UPDATE ${stagingTable(loadId, 'granules')} s
                SET seed_tgt_collection_id = c.seed_tgt_id
               FROM ${stagingTable(loadId, 'collections')} c
              WHERE c.cumulus_id = s.collection_cumulus_id`
          );
        }

        inserted[table] = await insertFromStaging({
          client,
          loadId,
          table,
          negotiation: negotiation[table],
          targetColumns: targetIntrospection[table],
          fills,
          ...plan[table],
        });
        logger.info(`[${loadId}] inserted ${table}: ${inserted[table]} rows`);
      }

      // Record before committing: if the commit then fails, the record points at rows
      // that do not exist, and reverting it deletes nothing. The opposite order could
      // leave committed rows with no record of them.
      Object.assign(record, {
        status: 'committing',
        staged,
        synthesizedExecutions,
        inserted,
        ids: await collectInsertedIds(client, loadId),
      });
      await writeRecord({ bucket, prefix, record });

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    Object.assign(record, { status: 'complete', finishedAt: new Date().toISOString() });
    await writeRecord({ bucket, prefix, record });

    return {
      dryRun: false,
      loadId,
      bundleUri,
      recordUri: `s3://${bucket}/${recordKey({ prefix, loadId })}`,
      staged,
      synthesizedExecutions,
      inserted,
    };
  });
};

module.exports = {
  NATURAL_KEYS,
  load,
  stagingTable,
};

/* eslint-enable no-await-in-loop */
