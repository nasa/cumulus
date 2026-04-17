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
const MAX_POOL_SIZE = Number(process.env.DUCKDB_MAX_POOL) || 20;

/**
 * Executes settings that should apply to every individual connection.
 */
const warmupConnection = async (conn: DuckDBConnection): Promise<void> => {
  const isLocal = process.env.NODE_ENV === 'development';

  if (isLocal) {
    // On Mac, let DuckDB download/load the correct architecture automatically
    // Using explicit INSTALL/LOAD ensures binaries exist on your local machine
    await conn.run('INSTALL httpfs; LOAD httpfs;');
    await conn.run('INSTALL iceberg; LOAD iceberg;');
    await conn.run('INSTALL aws; LOAD aws;');
  } else {
    // Production: Use pre-bundled Linux AMD64 extensions from the Docker image
    if (!dbVersionCache) {
      const versionRes = await conn.run('SELECT version();');
      const rows = await versionRes.getRows();
      dbVersionCache = (rows[0][0] as string) || 'unknown';
    }

    const extPath = '/app/.duckdb_extensions';
    const extBase = `${extPath}/${dbVersionCache}/linux_amd64`;
    await conn.run(`SET extension_directory='${extPath}';`);

    // Load bundled extensions
    await conn.run('LOAD parquet;');
    await conn.run('LOAD avro;');
    await conn.run(`LOAD '${extBase}/httpfs.duckdb_extension';`);
    await conn.run(`LOAD '${extBase}/iceberg.duckdb_extension';`);
    await conn.run(`LOAD '${extBase}/aws.duckdb_extension';`);
  }

  // This is critical for Glue and S3 signing to work properly
  const region = process.env.AWS_REGION || 'us-east-1';
  await conn.run(`SET s3_region='${region}';`);
  await conn.run('SET s3_url_style=\'vhost\';');

  // This populates DuckDB's internal session with your environment/profile credentials
  await conn.run('CALL load_aws_credentials();');

  // The Iceberg extension requires a formal 'SECRET' object to authorize S3 calls
  // 'credential_chain' allows it to automatically pick up the credentials from Step 2
  await conn.run('CREATE SECRET IF NOT EXISTS (TYPE S3, PROVIDER credential_chain);');
};

/**
 * Initialize the DuckDB Instance and load required extensions.
 */
export const initializeDuckDb = async (): Promise<void> => {
  if (instance) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      log.info('Initializing DuckDB Instance for Iceberg API...');
      instance = await DuckDBInstance.create(':memory:');

      const setupConn = await instance.connect();
      await warmupConnection(setupConn);

      // Use your AWS Account ID and the specific schema name
      const awsAccountId = process.env.AWS_ACCOUNT_ID;
      const glueSchema = process.env.ICEBERG_GLUE_SCHEMA;

      if (!awsAccountId) {
        throw new Error('AWS_ACCOUNT_ID environment variable is required.');
      }
      if (!glueSchema) {
        throw new Error('ICEBERG_GLUE_SCHEMA environment variable is required.');
      }

      log.info(`Attaching Iceberg Glue catalog for account: ${awsAccountId}`);

      // Attach the account-level catalog
      await setupConn.run(
        `ATTACH '${awsAccountId}' AS glue_iceberg (TYPE iceberg, ENDPOINT_TYPE 'glue');`
      );

      // Map only the tables you need from your specific schema
      const tableNames = [
        'granules', 'collections', 'executions', 'pdrs',
        'providers', 'rules', 'async_operations', 'granules_executions',
      ];

      for (const tableName of tableNames) {
        try {
          // Point specifically to your schema inside the attached catalog
          // eslint-disable-next-line no-await-in-loop
          await setupConn.run(
            `CREATE OR REPLACE VIEW ${quoteIdent(tableName)} AS
             SELECT * FROM glue_iceberg.${quoteIdent(glueSchema)}.${quoteIdent(tableName)};`
          );
          log.debug(`View created for ${glueSchema}.${tableName}`);
        } catch (error) {
          // Log warning if a specific table is missing from your schema
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

  return initPromise;
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
    // No .close() method exists on DuckDBConnection.
    // Simply allowing the reference to be dropped is the correct way
    // to handle connections that exceed the pool limit.
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
