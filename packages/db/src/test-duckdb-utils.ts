import type { Knex } from 'knex';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

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
  connection: { run(sql: string, params?: readonly unknown[]): Promise<unknown> },
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

  await connection.run(insertQuery.sql, insertQuery.bindings);

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
