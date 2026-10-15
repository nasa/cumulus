// @ts-check

/* eslint-disable no-await-in-loop */

'use strict';

const chunk = require('lodash/chunk');
const Logger = require('@cumulus/logger');

const { withPgClient } = require('./connect');
const { listRecords, readRecord, writeRecord } = require('./record');

const logger = new Logger({ sender: '@cumulus/granule-seed/revert' });

const BATCH = 10_000;

/**
 * Temp tables holding the ids to delete, filled from the load record. They are TEMP so
 * they disappear with the connection; revert never issues DROP or TRUNCATE.
 */
const ID_TABLES = Object.freeze({
  granules: {
    ddl: 'cumulus_id BIGINT NOT NULL, collection_cumulus_id INTEGER NOT NULL',
    columns: ['cumulus_id', 'collection_cumulus_id'],
    types: ['bigint', 'integer'],
  },
  executions: {
    ddl: 'cumulus_id BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL',
    columns: ['cumulus_id', 'created_at'],
    types: ['bigint', 'timestamptz'],
  },
  pdrs: { ddl: 'cumulus_id BIGINT NOT NULL', columns: ['cumulus_id'], types: ['bigint'] },
  rules: { ddl: 'cumulus_id BIGINT NOT NULL', columns: ['cumulus_id'], types: ['bigint'] },
  async_operations: {
    ddl: 'cumulus_id BIGINT NOT NULL', columns: ['cumulus_id'], types: ['bigint'],
  },
  providers: { ddl: 'cumulus_id BIGINT NOT NULL', columns: ['cumulus_id'], types: ['bigint'] },
  collections: {
    ddl: 'cumulus_id BIGINT NOT NULL', columns: ['cumulus_id'], types: ['bigint'],
  },
});

/**
 * @param {string} table
 * @returns {string}
 */
const idTable = (table) => `granule_seed_revert_${table}`;

/**
 * Deletes in child-to-parent order, each joined to the recorded ids. Granule and file
 * deletes carry both hash-partition keys so each one prunes to the right partitions.
 * Dimension rows appear in the record only if the load created them, so a collection
 * that already existed in the target is never deleted.
 *
 * @returns {{table: string, sql: string}[]}
 */
const revertStatements = () => [
  {
    table: 'granules_executions',
    sql: `DELETE FROM granules_executions t USING ${idTable('granules')} g
           WHERE t.granule_cumulus_id = g.cumulus_id
             AND t.collection_cumulus_id = g.collection_cumulus_id`,
  },
  {
    table: 'files',
    sql: `DELETE FROM files t USING ${idTable('granules')} g
           WHERE t.granule_cumulus_id = g.cumulus_id
             AND t.collection_cumulus_id = g.collection_cumulus_id`,
  },
  {
    table: 'granules',
    sql: `DELETE FROM granules t USING ${idTable('granules')} g
           WHERE t.cumulus_id = g.cumulus_id
             AND t.collection_cumulus_id = g.collection_cumulus_id`,
  },
  {
    table: 'pdrs',
    sql: `DELETE FROM pdrs t USING ${idTable('pdrs')} s WHERE t.cumulus_id = s.cumulus_id`,
  },
  {
    table: 'executions',
    sql: `DELETE FROM executions t USING ${idTable('executions')} s
           WHERE t.cumulus_id = s.cumulus_id AND t.created_at = s.created_at`,
  },
  ...['rules', 'async_operations', 'providers', 'collections'].map((table) => ({
    table,
    sql: `DELETE FROM ${table} t USING ${idTable(table)} s WHERE t.cumulus_id = s.cumulus_id`,
  })),
];

/**
 * Fill the id temp tables from the record, in batches, via unnest of typed arrays.
 *
 * @param {import('pg').Client} client
 * @param {Record<string, any[]>} ids
 * @returns {Promise<void>}
 */
const loadIdTables = async (client, ids) => {
  for (const [table, spec] of Object.entries(ID_TABLES)) {
    await client.query(`CREATE TEMP TABLE ${idTable(table)} (${spec.ddl})`);
    const values = ids[table] ?? [];
    for (const batch of chunk(values, BATCH)) {
      const columns = spec.columns.map((_, i) => (spec.columns.length === 1
        ? batch
        : batch.map((row) => row[i])));
      const params = spec.types.map((type, i) => `$${i + 1}::${type}[]`).join(', ');
      await client.query(
        `INSERT INTO ${idTable(table)} (${spec.columns.join(', ')})
         SELECT * FROM unnest(${params})`,
        columns
      );
    }
    await client.query(`ANALYZE ${idTable(table)}`);
  }
};

/**
 * @param {object} params
 * @param {string} params.bucket
 * @param {string} params.prefix
 * @returns {Promise<object[]>}
 */
const listLoads = ({ bucket, prefix }) => listRecords({ bucket, prefix });

/**
 * Remove everything one load inserted, in a single transaction, working from its record.
 *
 * The target's delete triggers keep the `*_global_unique` tables in step. A delete that
 * fails — for example because a real granule has since been attached to a collection the
 * load created — rolls the whole revert back.
 *
 * @param {object} params
 * @param {string} params.bucket
 * @param {string} params.prefix
 * @param {string} params.loadId
 * @param {NodeJS.ProcessEnv} [params.env]
 * @returns {Promise<Record<string, number>>} rows deleted per table
 */
const revert = async ({ bucket, prefix, loadId, env = process.env }) => {
  const record = await readRecord({ bucket, prefix, loadId });
  if (!['complete', 'committing'].includes(record.status)) {
    throw new Error(`Load ${loadId} has status "${record.status}"; only a complete load `
      + 'can be reverted.');
  }

  const deleted = await withPgClient(
    { env, applicationName: 'cumulus-granule-seed-revert' },
    async (client) => {
      const { rows } = await client.query('SELECT current_database() AS database');
      if (rows[0].database !== record.target.database) {
        throw new Error(`Load ${loadId} went into database "${record.target.database}", but `
          + `this connection is to "${rows[0].database}". Refusing to revert.`);
      }

      await loadIdTables(client, record.ids);

      /** @type {Record<string, number>} */
      const counts = {};
      await client.query('BEGIN');
      try {
        for (const { table, sql } of revertStatements()) {
          const result = await client.query(sql);
          counts[table] = result.rowCount ?? 0;
          logger.info(`[${loadId}] deleted ${table}: ${counts[table]} rows`);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      return counts;
    }
  );

  await writeRecord({
    bucket,
    prefix,
    record: { ...record, status: 'reverted', revertedAt: new Date().toISOString(), deleted },
  });
  return deleted;
};

module.exports = { listLoads, revert, revertStatements };

/* eslint-enable no-await-in-loop */
