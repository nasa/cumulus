import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import Logger from '@cumulus/logger';

const log = new Logger({ sender: '@cumulus/db/iceberg-connection' });

/**
 * Wraps an identifier in double-quotes and escapes any embedded double-quotes
 * by doubling them (standard SQL identifier quoting).
 * e.g. foo -> "foo", foo"bar -> "foo""bar"
 */
const quoteIdent = (ident: string): string => `"${ident.replace(/"/g, '""')}"`;

let instance: DuckDBInstance | undefined;
let initPromise: Promise<void> | undefined;
let dbVersionCache: string | undefined;

const connectionPool: DuckDBConnection[] = [];
const MAX_POOL_SIZE = Number(process.env.DUCKDB_MAX_POOL) || 3;

/**
 * Executes settings that should apply to every individual connection.
 */
const warmupConnection = async (conn: DuckDBConnection): Promise<void> => {
  const isLocal = process.env.NODE_ENV === 'development';

  if (isLocal) {
    await conn.run('INSTALL httpfs; LOAD httpfs;');
    await conn.run('INSTALL iceberg; LOAD iceberg;');
    await conn.run('INSTALL aws; LOAD aws;');
  } else {
    // Production: Use pre-bundled Linux ARM64 extensions from the Docker image
    if (!dbVersionCache) {
      const versionRes = await conn.run('SELECT version();');
      const rows = await versionRes.getRows();
      dbVersionCache = (rows[0][0] as string) || 'unknown';
    }

    const extPath = '/app/.duckdb_extensions';
    const extBase = `${extPath}/${dbVersionCache}/linux_arm64`;
    await conn.run(`SET extension_directory='${extPath}';`);

    // Load bundled extensions
    await conn.run('LOAD parquet;');
    await conn.run('LOAD avro;');
    await conn.run(`LOAD '${extBase}/httpfs.duckdb_extension';`);
    await conn.run(`LOAD '${extBase}/iceberg.duckdb_extension';`);
    await conn.run(`LOAD '${extBase}/aws.duckdb_extension';`);
  }

  const region = process.env.AWS_REGION || 'us-east-1';
  await conn.run(`SET s3_region='${region}';`);
  await conn.run('SET s3_url_style=\'vhost\';');

  await conn.run('CALL load_aws_credentials();');
  await conn.run('CREATE SECRET IF NOT EXISTS (TYPE S3, PROVIDER credential_chain);');
};

/**
 * Initialize the DuckDB Instance and load required extensions.
 */
export const initializeDuckDb = async (): Promise<void> => {
  if (instance) return;
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    try {
      log.info('Initializing DuckDB Instance for Iceberg API...');
      instance = await DuckDBInstance.create(':memory:');

      const setupConn = await instance.connect();
      await warmupConnection(setupConn);

      const awsAccountId = process.env.AWS_ACCOUNT_ID;
      const glueSchema = process.env.ICEBERG_NAMESPACE;

      if (!awsAccountId) {
        throw new Error('AWS_ACCOUNT_ID environment variable is required.');
      }
      if (!glueSchema) {
        throw new Error('ICEBERG_NAMESPACE environment variable is required.');
      }

      log.info(`Attaching Iceberg Glue catalog for account: ${awsAccountId}`);

      // Attach the account-level catalog
      await setupConn.run(
        `ATTACH '${awsAccountId}' AS glue_iceberg (TYPE iceberg, ENDPOINT_TYPE 'glue');`
      );

      const tableNames = [
        'granules', 'collections', 'executions', 'pdrs',
        'providers', 'rules', 'async_operations', 'granules_executions',
      ];

      for (const tableName of tableNames) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await setupConn.run(
            `CREATE OR REPLACE VIEW ${quoteIdent(tableName)} AS
             SELECT * FROM glue_iceberg.${quoteIdent(glueSchema)}.${quoteIdent(tableName)};`
          );
          log.debug(`View created for ${glueSchema}.${tableName}`);
        } catch (error) {
          log.warn(`Table ${tableName} not found in schema ${glueSchema}. Skipping.`);
        }
      }

      // Fill the pool
      connectionPool.push(setupConn);
      const remainingCount = MAX_POOL_SIZE - connectionPool.length;

      if (remainingCount > 0) {
        const newConns = await Promise.all(
          Array.from({ length: remainingCount }).map(async () => {
            const conn = await instance!.connect();
            await warmupConnection(conn);
            return conn;
          })
        );
        connectionPool.push(...newConns);
      }

      log.info('DuckDB initialization and view creation complete.');
    } catch (error) {
      log.error('Failed to initialize DuckDB:', error);
      instance = undefined;
      initPromise = undefined;
      throw error;
    }
  })();

  await initPromise;
};

/**
 * Acquire a connection from the pool or create a new one.
 */
export const acquireDuckDbConnection = async (): Promise<DuckDBConnection> => {
  if (!instance) {
    await initializeDuckDb();
  }

  if (connectionPool.length > 0) {
    return connectionPool.pop()!;
  }

  const conn = await instance!.connect();
  await warmupConnection(conn);
  return conn;
};

/**
 * Release a connection back to the pool for reuse.
 */
export const releaseDuckDbConnection = async (conn: DuckDBConnection): Promise<void> => {
  if (connectionPool.length < MAX_POOL_SIZE) {
    connectionPool.push(conn);
  } else {
    log.debug('Pool full, discarding connection reference.');
  }
};

/**
 * Cleanup function for graceful shutdown.
 */
export const destroyDuckDb = async (): Promise<void> => {
  log.info('Shutting down DuckDB...');
  connectionPool.length = 0;
  instance = undefined;
  initPromise = undefined;
  dbVersionCache = undefined;
};
