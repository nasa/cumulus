import type { Knex } from 'knex';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import {
  asyncOperationsS3TableSql,
  collectionsS3TableSql,
  executionsS3TableSql,
  filesS3TableSql,
  granulesS3TableSql,
  granulesExecutionsS3TableSql,
  providersS3TableSql,
  pdrsS3TableSql,
  reconciliationReportsS3TableSql,
  rulesS3TableSql,
} from './s3search/s3TableSchemas';
import { prepareBindings } from './s3search/duckdbHelpers';

/**
 * Creates a DuckDB in-memory instance and sets up S3/httpfs for testing.
 * Returns the instance and connection.
 */
export async function createDuckDBWithS3(): Promise<{
  instance: DuckDBInstance;
  connection: DuckDBConnection;
}> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();

  // Configure DuckDB HTTPFS for S3
  await connection.run(`
    INSTALL httpfs;
    LOAD httpfs;
    SET s3_region='us-east-1';
    SET s3_access_key_id='test';
    SET s3_secret_access_key='test';
    SET s3_endpoint='localhost:4566';
    SET s3_use_ssl=false;
    SET s3_url_style='path';
  `);

  return { instance, connection };
}

export async function createDuckDBTableFromData<
  T extends Record<string, any>
>(
  connection: DuckDBConnection,
  knexBuilder: Knex,
  tableName: string,
  tableSql: (tableName: string) => string,
  data: T | T[],
  s3Path: string
): Promise<void> {
  if (!data || (Array.isArray(data) && data.length === 0)) return;

  const rows: T[] = Array.isArray(data) ? data : [data];
  const tmpTableName = `${tableName}_tmp`;

  // Create temporary table
  await connection.run(tableSql(tmpTableName));

  // Insert into temp table
  if (tableName === 'executions') {
    // Execution rows need parent → child ordering
    type ExecutionRow = { parent_cumulus_id?: number | null; [key: string]: any };
    const execRows = rows as ExecutionRow[];

    const parentRows = execRows.filter((r) => !r.parent_cumulus_id);
    const childRows = execRows.filter((r) => r.parent_cumulus_id);

    if (parentRows.length > 0) {
      const parentInsert = knexBuilder(tmpTableName)
        .insert(parentRows)
        .toSQL()
        .toNative();
      await connection.run(parentInsert.sql, prepareBindings(parentInsert.bindings));
    }

    if (childRows.length > 0) {
      const childInsert = knexBuilder(tmpTableName)
        .insert(childRows)
        .toSQL()
        .toNative();
      await connection.run(childInsert.sql, prepareBindings(childInsert.bindings));
    }
  } else {
    // Generic insert for other tables
    const insertQuery = knexBuilder(tmpTableName)
      .insert(rows)
      .toSQL()
      .toNative();
    await connection.run(insertQuery.sql, prepareBindings(insertQuery.bindings));
  }

  // Export temp table to Parquet (safe)
  await connection.run(`
    COPY ${tmpTableName}
    TO '${s3Path}'
    (FORMAT PARQUET);
  `);

  // Load into formal table
  if (tableName === 'executions') {
    // Insert parents first
    await connection.run(`
      INSERT INTO ${tableName}
      SELECT * FROM ${tmpTableName}
      WHERE parent_cumulus_id IS NULL;
    `);

    // Insert children next
    await connection.run(`
      INSERT INTO ${tableName}
      SELECT * FROM ${tmpTableName}
      WHERE parent_cumulus_id IS NOT NULL;
    `);
  } else {
    // Generic table: direct COPY FROM temp table
    await connection.run(`
      INSERT INTO ${tableName}
      SELECT * FROM ${tmpTableName};
    `);
  }

  // Drop temp table
  await connection.run(`DROP TABLE IF EXISTS ${tmpTableName};`);
}

export async function createDuckDBTables(
  connection: DuckDBConnection
): Promise<void> {
  await connection.run(asyncOperationsS3TableSql());
  await connection.run(collectionsS3TableSql());
  await connection.run(providersS3TableSql());
  await connection.run(granulesS3TableSql());
  await connection.run(filesS3TableSql());
  await connection.run(executionsS3TableSql());
  await connection.run(granulesExecutionsS3TableSql());
  await connection.run(pdrsS3TableSql());
  await connection.run(reconciliationReportsS3TableSql());
  await connection.run(rulesS3TableSql());
}
