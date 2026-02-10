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

export async function createDuckDBTableFromData<T>(
  connection: DuckDBConnection,
  knexBuilder: Knex,
  tableName: string,
  tableSql: (tableName: string) => string,
  data: T | T[],
  s3Path: string
): Promise<void> {
  if (!data || (Array.isArray(data) && data.length === 0)) return;

  const tmpTableName = `${tableName}_tmp`;

  await connection.run(tableSql(tmpTableName));

  const insertQuery = knexBuilder(tmpTableName)
    .insert(data)
    .toSQL()
    .toNative();

  await connection.run(insertQuery.sql, prepareBindings(insertQuery.bindings));

  await connection.run(`
    COPY ${tmpTableName}
    TO '${s3Path}'
    (FORMAT PARQUET);
  `);

  await connection.run(`DROP TABLE IF EXISTS ${tmpTableName}`);
  await connection.run(tableSql(tableName));

  await connection.run(`
    COPY ${tableName}
    FROM '${s3Path}'
    (FORMAT PARQUET);
  `);
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
