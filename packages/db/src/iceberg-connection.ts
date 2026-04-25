import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import Logger from '@cumulus/logger';

const log = new Logger({ sender: '@cumulus/db/iceberg-connection' });

let instance: DuckDBInstance | undefined;
let initPromise: Promise<void> | undefined;
let dbVersionCache: string | undefined;
let poolCacheWarmupPromise: Promise<void> | undefined;

const connectionPool: DuckDBConnection[] = [];
const MAX_POOL_SIZE = Number(process.env.DUCKDB_MAX_POOL) || 3;
const ENABLE_CACHE_WARMUP = process.env.DUCKDB_ENABLE_CACHE_WARMUP !== 'false';
const tableNames = [
  'granules',
  'collections',
  'executions',
  'pdrs',
  'providers',
  'rules',
  'async_operations',
  'granules_executions',
];

/**
 * Wraps an identifier in double-quotes and escapes any embedded double-quotes
 * by doubling them (standard SQL identifier quoting).
 * e.g. foo -> "foo", foo"bar -> "foo""bar"
 */
function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Retrieves the value of a required environment variable.
 * Throws an error if the variable is not set or empty.
 */
function getRequiredEnv(name: 'AWS_ACCOUNT_ID' | 'ICEBERG_NAMESPACE'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }

  return value;
}

/**
 * Creates a new DuckDB connection from the shared instance and fully configures it:
 * loads required extensions, applies performance settings, refreshes AWS credentials,
 * attaches the Iceberg Glue catalog, and sets the default search path to the configured namespace.
 */
async function getConnection(): Promise<DuckDBConnection> {
  const isLocal = process.env.NODE_ENV === 'development';
  const awsAccountId = getRequiredEnv('AWS_ACCOUNT_ID');
  const glueSchema = getRequiredEnv('ICEBERG_NAMESPACE');

  const conn = await instance!.connect();
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

  // ECS_TASK_MEMORY is in MiB; use half of that for DuckDB.
  const ecsMemoryMiB = Number(process.env.ECS_TASK_MEMORY) || 1024;
  const memoryLimitMiB = Math.floor(ecsMemoryMiB / 2);
  // ECS_TASK_CPU is in CPU units (1024 = 1 vCPU); derive thread count from it.
  const ecsCpuUnits = Number(process.env.ECS_TASK_CPU) || 1024;
  const threadCount = Math.max(1, Math.floor(ecsCpuUnits / 1024));
  await conn.run(`SET memory_limit='${memoryLimitMiB}MB';`);
  await conn.run(`SET threads=${threadCount};`);
  await conn.run('SET parquet_metadata_cache=true;');
  await conn.run('SET enable_http_metadata_cache=true;');
  await conn.run('SET enable_object_cache=true;');
  await conn.run('SET http_keep_alive=true;');

  await conn.run('CALL load_aws_credentials();');
  await conn.run('CREATE SECRET IF NOT EXISTS (TYPE S3, PROVIDER credential_chain);');

  // ATTACH is instance-level: only run it once; subsequent connections reuse the catalog.
  const attached = await conn.run(
    'SELECT count(*) FROM duckdb_databases() WHERE database_name = \'glue_iceberg\';'
  );
  const rows = await attached.getRows();
  const alreadyAttached = (rows[0][0] as number) > 0;
  if (!alreadyAttached) {
    await conn.run(
      `ATTACH '${awsAccountId}' AS glue_iceberg (TYPE iceberg, ENDPOINT_TYPE 'glue');`
    );
  }

  await conn.run(`SET search_path = 'glue_iceberg.${glueSchema}';`);

  return conn;
}

/**
 * Pre-populate connection-level metadata and file/cache state for known views.
 */
async function populateConnectionCache(conn: DuckDBConnection): Promise<void> {
  for (const tableName of tableNames) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await conn.run(`SELECT COUNT(*) FROM ${quoteIdent(tableName)};`);
    } catch (error) {
      log.debug(`Cache warmup skipped for table ${tableName}.`);
    }
  }
}

/**
 * Start one-time background cache population for currently pooled connections.
 */
function startPoolCacheWarmup(): void {
  if (!ENABLE_CACHE_WARMUP) {
    log.info('DuckDB cache warmup disabled by DUCKDB_ENABLE_CACHE_WARMUP.');
    return;
  }

  if (poolCacheWarmupPromise) return;

  poolCacheWarmupPromise = (async () => {
    log.info('Starting background cache warmup for pooled DuckDB connections...');
    await Promise.all(connectionPool.map((conn) => populateConnectionCache(conn)));
    log.info('Background cache warmup for pooled connections complete.');
  })().catch((error) => {
    log.warn('Background cache warmup encountered an error. Continuing without blocking startup.', error);
  });
}

/**
 * Start background cache warmup for a single connection.
 */
function startConnectionCacheWarmup(conn: DuckDBConnection): void {
  if (!ENABLE_CACHE_WARMUP) {
    return;
  }

  const cacheWarmupPromise = populateConnectionCache(conn);
  cacheWarmupPromise.catch((error) => {
    log.warn('Background cache warmup for connection failed.', error);
  });
}

/**
 * Initialize the DuckDB Instance and load required extensions.
 */
export async function initializeDuckDb(): Promise<void> {
  if (instance) return;
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    try {
      log.info('Initializing DuckDB Instance for Iceberg API...');
      instance = await DuckDBInstance.create(':memory:');

      // Connections must be initialized sequentially to avoid write-write conflicts
      // in DuckDB's catalog (e.g. concurrent CREATE SECRET calls).
      for (let i = 0; i < MAX_POOL_SIZE; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        connectionPool.push(await getConnection());
      }

      startPoolCacheWarmup();

      log.info(`DuckDB initialized with a pool of ${connectionPool.length}/${MAX_POOL_SIZE} connections.`);
    } catch (error) {
      log.error('Failed to initialize DuckDB:', error);
      instance = undefined;
      initPromise = undefined;
      throw error;
    }
  })();

  await initPromise;
}

/**
 * Acquire a connection from the pool or create a new one.
 */
export async function acquireDuckDbConnection(): Promise<DuckDBConnection> {
  if (!instance) {
    await initializeDuckDb();
  }

  if (connectionPool.length > 0) {
    return connectionPool.pop()!;
  }

  const conn = await getConnection();
  startConnectionCacheWarmup(conn);
  return conn;
}

/**
 * Release a connection back to the pool for reuse.
 */
export async function releaseDuckDbConnection(conn: DuckDBConnection): Promise<void> {
  if (connectionPool.length < MAX_POOL_SIZE) {
    connectionPool.push(conn);
  } else {
    log.debug('Pool full, discarding connection reference.');
  }
}

/**
 * Cleanup function for graceful shutdown.
 */
export async function destroyDuckDb(): Promise<void> {
  log.info('Shutting down DuckDB...');
  connectionPool.length = 0;
  instance = undefined;
  initPromise = undefined;
  dbVersionCache = undefined;
  poolCacheWarmupPromise = undefined;
}
