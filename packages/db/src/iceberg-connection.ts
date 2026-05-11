import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import Logger from '@cumulus/logger';

const log = new Logger({ sender: '@cumulus/db/iceberg-connection' });

let instance: DuckDBInstance | undefined;
let initPromise: Promise<void> | undefined;
let dbVersionCache: string | undefined;
export interface PooledDuckDbConnection extends DuckDBConnection {
  creationTime: number;
}

let poolCacheWarmupPromise: Promise<void> | undefined;
let isPoolCacheWarmupComplete = false;
let backgroundRefreshInterval: NodeJS.Timeout | undefined;
let refreshPoolPromise: Promise<void> | undefined;

const connectionPool: PooledDuckDbConnection[] = [];
const inUseConnections = new Set<PooledDuckDbConnection>();
const MAX_POOL_SIZE = Number(process.env.DUCKDB_MAX_POOL) || 3;
const ENABLE_CACHE_WARMUP = process.env.DUCKDB_ENABLE_CACHE_WARMUP !== 'false';
const STALE_CONNECTION_THRESHOLD_MS = 5 * 60 * 60 * 1000; // 5 hours
const BACKGROUND_CHECK_INTERVAL_MS =
  Number(process.env.DUCKDB_POOL_CHECK_INTERVAL) || 10 * 60 * 1000; // 10 minutes
const tableNames = [
  'granules',
  'collections',
  'executions',
  'files_table',
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
 *
 * @param ident - identifier to quote
 * @returns quoted SQL identifier
 */
function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Retrieves the value of a required environment variable.
 * Throws an error if the variable is not set or empty.
 *
 * @param name - required environment variable name
 * @returns required environment variable value
 */
function getRequiredEnv(name: 'AWS_ACCOUNT_ID' | 'ICEBERG_NAMESPACE'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }

  return value;
}

let lastSecretRefresh = 0;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let secretRefreshPromise: Promise<boolean> | undefined;
let isGlueAttached = false;

/**
 * Refreshes the DuckDB AWS secret only when the refresh interval has elapsed.
 * Concurrent callers share a single in-flight refresh promise to avoid issuing
 * multiple simultaneous CREATE OR REPLACE SECRET commands.
 *
 * @param conn - active DuckDB connection used to execute the secret refresh
 * @returns true if the secret was refreshed, false otherwise
 */
async function ensureFreshSecret(conn: DuckDBConnection): Promise<boolean> {
  const now = Date.now();
  if (now - lastSecretRefresh <= REFRESH_INTERVAL_MS) return false;

  if (secretRefreshPromise) {
    return await secretRefreshPromise;
  }

  secretRefreshPromise = (async () => {
    try {
      await conn.run('CREATE OR REPLACE SECRET (TYPE S3, PROVIDER credential_chain);');
      lastSecretRefresh = Date.now();
      log.info('DuckDB AWS Secret refreshed.');
      return true;
    } catch (error) {
      lastSecretRefresh = 0;
      log.warn('DuckDB AWS Secret refresh failed:', error);
      return false;
    } finally {
      secretRefreshPromise = undefined;
    }
  })();

  return await secretRefreshPromise;
}

/**
 * Applies all session-level configuration to an existing DuckDB connection:
 * loads required extensions, applies performance settings, refreshes AWS credentials,
 * attaches (or re-attaches) the Iceberg Glue catalog, and sets the default search path.
 *
 * Safe to call on a freshly created connection as well as on a pooled connection
 * that has lost its catalog state (e.g. after being idle overnight).
 *
 * @param conn
 */
async function configureConnection(conn: DuckDBConnection): Promise<void> {
  const isLocal = process.env.NODE_ENV === 'development';
  const awsAccountId = getRequiredEnv('AWS_ACCOUNT_ID');
  const glueSchema = getRequiredEnv('ICEBERG_NAMESPACE');

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
  const wasRefreshed = await ensureFreshSecret(conn);

  // ATTACH is instance-level: only run it once; subsequent connections reuse the catalog.
  if (wasRefreshed || !isGlueAttached) {
    if (isGlueAttached) {
      log.info('Refreshing catalog attachment due to credential rotation.');
      try {
        await conn.run('USE memory.main;');
        await conn.run('DETACH glue_iceberg;');
      } catch (e) {
        log.warn('Detach failed (likely already detached by another connection)', e);
      }
    }

    try {
      await conn.run(
        `ATTACH '${awsAccountId}' AS glue_iceberg (TYPE iceberg, ENDPOINT_TYPE 'glue');`
      );
      isGlueAttached = true;
    } catch (e) {
      // If two connections try to ATTACH at the same time, one will fail with
      // "Database already exists". We check if it's there.
      const checkRes = await conn.run("SELECT count(*) FROM duckdb_databases() WHERE database_name = 'glue_iceberg';");
      const rows = await checkRes.getRows();
      if ((rows[0][0] as number) === 0) {
        log.error('Failed to attach glue_iceberg catalog and it is not present.', e);
        // We still don't throw here. We let the 'USE' block below catch it.
      } else {
        log.warn('ATTACH failed but catalog is already present (concurrent attach).');
        isGlueAttached = true;
      }
    }
  }

  // Final verification: Ensure we can actually enter the schema
  try {
    await conn.run(`USE glue_iceberg.${quoteIdent(glueSchema)};`);
  } catch (error) {
    // If USE fails, the catalog is attached but the schema/metadata is inaccessible.
    log.warn('USE schema failed. Forcing a clean re-attach.', error);
    await conn.run('USE memory.main;');
    try {
      await conn.run('DETACH glue_iceberg;');
    } catch (e) {
      log.warn('Detach failed (likely already detached by another connection)', e);
    }
    await conn.run(`ATTACH '${awsAccountId}' AS glue_iceberg (TYPE iceberg, ENDPOINT_TYPE 'glue');`);
    isGlueAttached = true;
    await conn.run(`USE glue_iceberg.${quoteIdent(glueSchema)};`);
  }
}

/**
 * Creates a new DuckDB connection from the shared instance and fully configures it.
 */
async function getConnection(): Promise<PooledDuckDbConnection> {
  const connection = await instance!.connect();
  await configureConnection(connection);

  const pooledConn = connection as PooledDuckDbConnection;
  pooledConn.creationTime = Date.now();
  return pooledConn;
}

/**
 * Pre-populate connection-level metadata and file/cache state for known views.
 *
 * @param conn
 */
async function populateConnectionCache(conn: PooledDuckDbConnection): Promise<void> {
  for (const tableName of tableNames) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await conn.run(`SELECT COUNT(*) FROM ${quoteIdent(tableName)};`);
    } catch (error) {
      log.warn(`Cache warmup skipped for table ${tableName}.`, error);
    }
  }
}

/**
 * Creates and returns a new DuckDB connection that has cache warmup initiated.
 */
export async function replaceDuckDbConnection(): Promise<PooledDuckDbConnection> {
  const newConn = await getConnection();
  if (ENABLE_CACHE_WARMUP) {
    populateConnectionCache(newConn).catch((error: unknown) => {
      log.warn('Background cache warmup for connection failed.', error);
    });
  }
  return newConn;
}

/**
 * Start one-time background cache population for currently pooled connections.
 */
function startPoolCacheWarmup(): void {
  if (!ENABLE_CACHE_WARMUP) {
    log.info('DuckDB cache warmup disabled by DUCKDB_ENABLE_CACHE_WARMUP.');
    isPoolCacheWarmupComplete = true;
    return;
  }

  if (poolCacheWarmupPromise) return;

  poolCacheWarmupPromise = (async () => {
    try {
      log.info('Starting background cache warmup for pooled DuckDB connections...');
      await Promise.all(connectionPool.map((conn) => populateConnectionCache(conn)));
      log.info('Background cache warmup for pooled connections complete.');
    } finally {
      isPoolCacheWarmupComplete = true;
    }
  })().catch((error) => {
    log.warn('Background cache warmup encountered an error. Continuing without blocking startup.', error);
  });
}

/**
 * Start background cache warmup for a single connection.
 *
 * @param conn
 */
function startConnectionCacheWarmup(conn: PooledDuckDbConnection): void {
  if (!ENABLE_CACHE_WARMUP) {
    return;
  }

  const cacheWarmupPromise = populateConnectionCache(conn);
  cacheWarmupPromise.catch((error) => {
    log.warn('Background cache warmup for connection failed.', error);
  });
}

/**
 * Core logic for checking stale connections and replenishing the pool.
 */
async function performConnectionRefresh(): Promise<void> {
  const startTime = Date.now();
  let staleRemovedCount = 0;
  let replacementSuccessCount = 0;

  log.debug('Starting background check for stale DuckDB connections...');
  const staleThreshold = startTime - STALE_CONNECTION_THRESHOLD_MS;
  for (let i = connectionPool.length - 1; i >= 0; i -= 1) {
    const pooledConn = connectionPool[i];
    if (pooledConn.creationTime < staleThreshold) {
      connectionPool.splice(i, 1);
      staleRemovedCount += 1;
      try {
        pooledConn.closeSync();
      } catch (error) {
        log.warn('Error closing stale DuckDB connection', error);
      }
    }
  }

  const warmupPromises: Promise<void>[] = [];

  const neededReplacements = MAX_POOL_SIZE - connectionPool.length - inUseConnections.size;
  if (neededReplacements > 0) {
    log.debug(`Refilling pool: creating ${neededReplacements} new connections...`);
    for (let i = 0; i < neededReplacements; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const newConn = await getConnection();
        if (ENABLE_CACHE_WARMUP) {
          warmupPromises.push(
            populateConnectionCache(newConn).catch((error: unknown) => {
              log.warn('Background cache warmup for connection failed.', error);
            })
          );
        }
        connectionPool.push(newConn);
        replacementSuccessCount += 1;
      } catch (e) {
        log.error('Failed to create replacement DuckDB connection', e);
      }
    }
  }

  await Promise.all(warmupPromises);
  log.info(
    'Background pool check complete. '
    + `${staleRemovedCount} stale removed, ${replacementSuccessCount} explicitly refilled, `
    + `in ${Date.now() - startTime}ms.`
  );
}

/**
 * Refresh any connections older than the threshold.
 */
async function refreshStaleConnections(): Promise<void> {
  if (refreshPoolPromise) {
    await refreshPoolPromise;
    return;
  }

  refreshPoolPromise = performConnectionRefresh().finally(() => {
    refreshPoolPromise = undefined;
  });
  await refreshPoolPromise;
}

/**
 * Start the background job to periodically refresh stale connections.
 */
function startBackgroundConnectionRefresh(): void {
  if (backgroundRefreshInterval) return;
  backgroundRefreshInterval = setInterval(() => {
    refreshStaleConnections().catch((e) => log.error('Error during connection refresh', e));
  }, BACKGROUND_CHECK_INTERVAL_MS);
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
      startBackgroundConnectionRefresh();

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
export async function acquireDuckDbConnection(): Promise<PooledDuckDbConnection> {
  if (!instance) {
    await initializeDuckDb();
  }

  const staleThreshold = Date.now() - STALE_CONNECTION_THRESHOLD_MS;

  while (connectionPool.length > 0) {
    const conn = connectionPool.pop()!;
    if (conn.creationTime < staleThreshold) {
      log.debug('Discarding stale DuckDB connection on acquire.');
      try {
        conn.closeSync();
      } catch (e) {
        log.warn('Error closing stale DuckDB connection on acquire', e);
      }
    } else {
      inUseConnections.add(conn);
      return conn;
    }
  }

  const conn = await getConnection();
  startConnectionCacheWarmup(conn);
  inUseConnections.add(conn);
  return conn;
}

/**
 * Test-only helper to replace the active DuckDB instance and pool with
 * pre-configured connections.
 *
 * @param params
 * @param params.instance
 * @param params.pooledConnections
 */
export function setDuckDbStateForTesting(params: {
  instance: DuckDBInstance;
  pooledConnections: PooledDuckDbConnection[];
}): void {
  instance = params.instance;
  initPromise = Promise.resolve();
  poolCacheWarmupPromise = undefined;
  isPoolCacheWarmupComplete = true;
  isGlueAttached = true;
  connectionPool.length = 0;
  connectionPool.push(...params.pooledConnections);
  inUseConnections.clear();
}

/**
 * Release a connection back to the pool for reuse.
 *
 * @param conn
 */
export async function releaseDuckDbConnection(conn: PooledDuckDbConnection): Promise<void> {
  if (!inUseConnections.has(conn)) {
    log.error('Double release detected for DuckDB connection. Ignoring to prevent pool corruption.');
    return;
  }
  inUseConnections.delete(conn);

  const isStale = (Date.now() - conn.creationTime) > STALE_CONNECTION_THRESHOLD_MS;
  if (isStale) {
    log.info('Discarding stale connection instead of returning to pool.');
    try {
      conn.closeSync();
    } catch (error) {
      log.warn('Error closing stale DuckDB connection on release', error);
    }
    return;
  }

  if (connectionPool.length < MAX_POOL_SIZE) {
    connectionPool.push(conn);
  } else {
    log.debug('Pool full, discarding connection reference.');
    try {
      conn.closeSync();
    } catch (error) {
      log.warn('Error closing discarded DuckDB connection', error);
    }
  }
}

/**
 * Check if DuckDB is initialized and ready without acquiring a connection.
 * Used for lightweight health checks to avoid pool contention.
 *
 * @returns true when the DuckDB instance is initialized and pool warmup is complete
 */
export function isDuckDbReady(): boolean {
  return instance !== undefined && isPoolCacheWarmupComplete;
}

/**
 * Cleanup function for graceful shutdown.
 */
export async function destroyDuckDb(): Promise<void> {
  log.info('Shutting down DuckDB...');
  if (backgroundRefreshInterval) {
    clearInterval(backgroundRefreshInterval);
    backgroundRefreshInterval = undefined;
  }
  connectionPool.length = 0;
  inUseConnections.clear();
  instance = undefined;
  initPromise = undefined;
  dbVersionCache = undefined;
  poolCacheWarmupPromise = undefined;
  isPoolCacheWarmupComplete = false;
  isGlueAttached = false;
}
