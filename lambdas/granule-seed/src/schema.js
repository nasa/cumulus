// @ts-check

'use strict';

const crypto = require('crypto');
const { TableNames } = require('@cumulus/db');

/**
 * @typedef {object} ColumnDef
 * @property {string} column
 * @property {string} dataType - `information_schema.columns.data_type`
 * @property {string} udtName - `udt_name`, which distinguishes `text[]` from `text`
 * @property {boolean} isNullable
 * @property {boolean} hasDefault
 * @property {number} ordinal
 */

/**
 * @typedef {Record<string, ColumnDef[]>} Introspection
 */

/**
 * The granule foreign-key closure, in dependency order.
 *
 * `rules` is included (CUMULUS-5444 asks for seeded rules) but only the rules attached to
 * sampled collections, and always copied disabled with their trigger ARNs cleared — see
 * `extractionQueries`. `reconciliation_reports` is excluded: nothing reaches it from a
 * granule.
 *
 * The order matters on load and is reversed on delete. `pdrs` sits after `executions`
 * because of its composite FK `(execution_cumulus_id, execution_created_at)`, and before
 * `granules` because of `granules.pdr_cumulus_id`.
 */
const SEED_TABLES = Object.freeze([
  TableNames.collections,
  TableNames.providers,
  TableNames.asyncOperations,
  TableNames.rules,
  TableNames.executions,
  TableNames.pdrs,
  TableNames.granules,
  TableNames.files,
  TableNames.granulesExecutions,
]);

/**
 * Tables that must never be bundled or introspected as part of the closure.
 *
 * The three `*_global_unique` tables are maintained by per-row triggers and are not in
 * `TableNames`; the `*_old_non_partitioned` pair are migration leftovers that survive on
 * clusters whose row count exceeded the migration's threshold, so a real cluster may
 * still have them.
 */
const EXCLUDED_TABLES = Object.freeze([
  'granules_global_unique',
  'files_global_unique',
  'executions_global_unique',
  'granules_global_unique_old_non_partitioned',
  'files_global_unique_old_non_partitioned',
  TableNames.reconciliationReports,
]);

/**
 * Read column metadata for the given tables from `information_schema`.
 *
 * @param {import('pg').Client} client
 * @param {readonly string[]} tableNames
 * @param {string} [schema]
 * @returns {Promise<Introspection>}
 */
const introspectTables = async (client, tableNames, schema = 'public') => {
  const { rows } = await client.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable,
            column_default, ordinal_position
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = ANY($2)
      ORDER BY table_name, ordinal_position`,
    [schema, [...tableNames]]
  );

  /** @type {Introspection} */
  const result = {};

  rows.forEach((row) => {
    const table = row.table_name;
    if (!result[table]) result[table] = [];
    result[table].push({
      column: row.column_name,
      dataType: row.data_type,
      udtName: row.udt_name,
      isNullable: row.is_nullable === 'YES',
      hasDefault: row.column_default !== null,
      ordinal: Number(row.ordinal_position),
    });
  });

  return result;
};

/**
 * Assert every expected table exists, naming the missing ones.
 *
 * @param {Introspection} introspection
 * @param {readonly string[]} expected
 * @returns {void}
 */
const assertTablesPresent = (introspection, expected) => {
  const missing = expected.filter((table) => !introspection[table]?.length);
  if (missing.length > 0) {
    throw new Error(
      `Database is missing expected table(s): ${missing.join(', ')}. `
        + 'Has the schema been migrated?'
    );
  }
};

/**
 * A stable digest of the schema shape, used to detect drift between the cluster a bundle
 * was cut from and the cluster it is being loaded into.
 *
 * Deliberately covers name, type, nullability and default-presence but not ordinal
 * position, so that an additive migration that happens to reorder columns does not read
 * as a breaking change.
 *
 * @param {Introspection} introspection
 * @returns {string}
 */
const schemaFingerprint = (introspection) => {
  const parts = Object.keys(introspection)
    .sort()
    .map((table) => {
      const columns = [...introspection[table]]
        .sort((a, b) => a.column.localeCompare(b.column))
        .map((c) => `${c.column}:${c.udtName}:${c.isNullable ? 'null' : 'notnull'}`
          + `:${c.hasDefault ? 'default' : 'nodefault'}`)
        .join(',');
      return `${table}(${columns})`;
    });

  return `sha256:${crypto.createHash('sha256').update(parts.join(';')).digest('hex')}`;
};

/**
 * @typedef {object} TableNegotiation
 * @property {string[]} copyColumns - columns to include in the COPY, in bundle order
 * @property {string[]} dropped - target columns omitted so the target's default applies
 * @property {string[]} filled - target columns supplied from `--fill`
 * @property {string[]} errors - human-readable, actionable reasons to abort
 */

/**
 * Reconcile a bundle's recorded columns against the target's actual columns.
 *
 * Matching is by name, never by position. The abort cases are deliberately loud: silently
 * dropping a column or coercing a type produces a database that looks seeded and is
 * subtly wrong, which is far more expensive to discover later than a refused load.
 *
 * @param {object} params
 * @param {string} params.table
 * @param {ColumnDef[]} params.bundleColumns - as recorded in the tier manifest
 * @param {ColumnDef[]} params.targetColumns
 * @param {Record<string, string>} [params.fills] - `"table.column"` -> literal value
 * @returns {TableNegotiation}
 */
const negotiateTable = ({ table, bundleColumns, targetColumns, fills = {} }) => {
  const targetByName = new Map(targetColumns.map((c) => [c.column, c]));
  const bundleByName = new Map(bundleColumns.map((c) => [c.column, c]));

  /** @type {string[]} */
  const copyColumns = [];
  /** @type {string[]} */
  const dropped = [];
  /** @type {string[]} */
  const filled = [];
  /** @type {string[]} */
  const errors = [];

  bundleColumns.forEach((bundleColumn) => {
    const targetColumn = targetByName.get(bundleColumn.column);

    if (!targetColumn) {
      errors.push(
        `${table}.${bundleColumn.column} is in the bundle but not in the target. `
          + 'The source was ahead of the target, or the column was renamed or dropped. '
          + 'Re-extract from a source at the target\'s migration head.'
      );
      return;
    }

    if (targetColumn.udtName !== bundleColumn.udtName) {
      errors.push(
        `${table}.${bundleColumn.column} changed type under the same name: `
          + `bundle has ${bundleColumn.udtName}, target has ${targetColumn.udtName}.`
      );
      return;
    }

    copyColumns.push(bundleColumn.column);
  });

  targetColumns.forEach((targetColumn) => {
    if (bundleByName.has(targetColumn.column)) return;

    const fillKey = `${table}.${targetColumn.column}`;
    if (Object.prototype.hasOwnProperty.call(fills, fillKey)) {
      filled.push(targetColumn.column);
      return;
    }

    if (targetColumn.isNullable || targetColumn.hasDefault) {
      dropped.push(targetColumn.column);
      return;
    }

    errors.push(
      `${fillKey} exists in the target as NOT NULL with no default, but is absent from `
        + 'the bundle. The target has run a non-additive migration since the extract. '
        + `Re-extract, or supply a value with --fill ${fillKey}=<value>.`
    );
  });

  return { copyColumns, dropped, filled, errors };
};

/**
 * Negotiate every table, collecting all errors before throwing so that one run reports
 * every incompatibility rather than only the first.
 *
 * @param {object} params
 * @param {Record<string, ColumnDef[]>} params.bundleTables
 * @param {Introspection} params.targetIntrospection
 * @param {Record<string, string>} [params.fills]
 * @returns {Record<string, TableNegotiation>}
 */
const negotiate = ({ bundleTables, targetIntrospection, fills = {} }) => {
  /** @type {Record<string, TableNegotiation>} */
  const result = {};
  /** @type {string[]} */
  const allErrors = [];

  Object.keys(bundleTables).forEach((table) => {
    const negotiation = negotiateTable({
      table,
      bundleColumns: bundleTables[table],
      targetColumns: targetIntrospection[table] ?? [],
      fills,
    });
    result[table] = negotiation;
    allErrors.push(...negotiation.errors);
  });

  if (allErrors.length > 0) {
    throw new Error(
      `Bundle is not compatible with the target schema:\n  - ${allErrors.join('\n  - ')}`
    );
  }

  return result;
};

module.exports = {
  EXCLUDED_TABLES,
  SEED_TABLES,
  assertTablesPresent,
  introspectTables,
  negotiate,
  negotiateTable,
  schemaFingerprint,
};
