import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import Logger from '@cumulus/logger';

const log = new Logger({ sender: '@cumulus/db/iceberg-connection' });

let instance: DuckDBInstance | undefined;
let isInitializing = false;
let dbVersionCache: string | undefined;

const connectionPool: DuckDBConnection[] = [];
const MAX_POOL_SIZE = Number(process.env.DUCKDB_MAX_POOL) || 20;

/**
 * Executes settings that should apply to every individual connection.
 */
const warmupConnection = async (conn: DuckDBConnection): Promise<void> => {
  // Get/Cache Version
  if (!dbVersionCache) {
    const versionRes = await conn.run("SELECT version();");
    const rows = await versionRes.getRows();
    dbVersionCache = (rows[0][0] as string) || 'unknown';
  }

  const extPath = '/app/.duckdb_extensions';
  const extBase = `${extPath}/${dbVersionCache}/linux_amd64`;

  // Standard S3 & Engine Config
  await conn.run("SET s3_url_style='vhost';");
  await conn.run(`SET extension_directory='${extPath}';`);

  // Load Extensions
  await conn.run('LOAD parquet;');
  await conn.run('LOAD avro;');
  await conn.run(`LOAD '${extBase}/httpfs.duckdb_extension';`);
  await conn.run(`LOAD '${extBase}/iceberg.duckdb_extension';`);
  
  // Identity & Security
  await conn.run("CREATE SECRET IF NOT EXISTS (TYPE S3, PROVIDER credential_chain);");
};

/**
 * Initialize the DuckDB Instance and load required extensions.
 */
export const initializeDuckDb = async (): Promise<void> => {
  if (instance || isInitializing) return; 
  isInitializing = true;

  try {
    log.info('Initializing DuckDB Instance for Iceberg API...');
    instance = await DuckDBInstance.create(':memory:');
    
    const setupConn = await instance.connect();
    await warmupConnection(setupConn);

    // Verify critical function registration
    const funcCheck = await setupConn.run(
      "SELECT function_name FROM duckdb_functions() WHERE function_name = 'iceberg_scan';"
    );
    const funcRows = await funcCheck.getRows();
    
    if (funcRows.length === 0) {
      throw new Error(`iceberg_scan function failed to register for version ${dbVersionCache}`);
    }

    // CREATE VIEWS
    // const tablePath = process.env.ICEBERG_TABLE_PATH;
    const tablePath = process.env.ICEBERG_TABLE_PATH || 's3://yliu-sandbox-test-iceberg/warehouse/yliu_test';

    if (!tablePath) {
      throw new Error('ICEBERG_TABLE_PATH environment variable is required.');
    }
    
    log.info(`Creating views for Iceberg tables at ${tablePath}`);

    const tableNames = [
      'granules', 'collections', 'executions', 'files', 
      'granules_executions', 'pdrs', 'providers', 
      'reconciliation_reports', 'rules', 'async_operations'
    ];

    for (const tableName of tableNames) {
      const metadataFolder = `${tablePath}/${tableName}/metadata/`.replace(/([^:])\/\/+/g, '$1/');
      
      try {
        const globQuery = `SELECT file FROM glob('${metadataFolder}*.metadata.json') ORDER BY file DESC LIMIT 1;`;
        const res = await setupConn.run(globQuery);
        const rows = await res.getRows();

        if (rows.length === 0) {
          log.warn(`No metadata found for ${tableName}. Skipping view creation.`);
          continue;
        }

        const latestMetadataJson = rows[0][0];
        await setupConn.run(
          `CREATE OR REPLACE VIEW "${tableName}" AS SELECT * FROM iceberg_scan('${latestMetadataJson}');`
        );
      } catch (error) {
        log.error(`Critical error resolving table ${tableName}:`, error);
        throw error;
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
    throw error;
  } finally {
    isInitializing = false;
  }
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
  dbVersionCache = undefined;
};