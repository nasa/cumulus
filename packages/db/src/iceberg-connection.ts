import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import Logger from '@cumulus/logger';

const log = new Logger({ sender: '@cumulus/db/iceberg-connection' });

let instance: DuckDBInstance | undefined;
let initPromise: Promise<void> | undefined;
let dbVersionCache: string | undefined;

let poolCacheWarmupPromise: Promise<void> | undefined;
let isPoolCacheWarmupComplete = false;
let backgroundRefreshInterval: NodeJS.Timeout | undefined;
let refreshPoolPromise: Promise<void> | undefined;

const connectionPool: DuckDBConnection[] = [];
const inUseConnections = new Set<DuckDBConnection>();
const MAX_POOL_SIZE = Number(process.env.DUCKDB_MAX_POOL) || 3;
const ENABLE_CACHE_WARMUP = process.env.DUCKDB_ENABLE_CACHE_WARMUP !== 'false';
const POOL_REBUILD_INTERVAL_MS
  = Number(process.env.DUCKDB_POOL_REBUILD_INTERVAL) || 5 * 60 * 60 * 1000; // 5 hours
let lastSecretRefresh = 0;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let secretRefreshPromise: Promise<boolean> | undefined;
let isGlueAttached = false;
let lastCatalogRefreshForSecretAt = 0;
let glueCatalogMaintenanceChain: Promise<void> = Promise.resolve();
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

/**
 * Serializes any operation that mutates the shared Glue catalog attachment
 * state.
 *
 * DuckDB's Iceberg catalog is instance-wide, so concurrent detach/attach
 * cycles can race with one another and with queries that are already using the
 * catalog. This helper makes sure only one maintenance operation runs at a
 * time.
 *
 * @param operation - catalog maintenance work to run exclusively
 */
async function withGlueCatalogMaintenance<T>(operation: () => Promise<T>): Promise<T> {
  const run = glueCatalogMaintenanceChain.then(operation, operation);
  glueCatalogMaintenanceChain = run.then(() => undefined, () => undefined);
  return await run;
}

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
      await conn.run(
        'CREATE OR REPLACE SECRET (TYPE S3, PROVIDER credential_chain, REFRESH auto);'
      );
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
 * Pre-populate connection-level metadata and file/cache state for known views.
 *
 * @param conn
 */
async function populateInstanceCache(conn: DuckDBConnection): Promise<void> {
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
 * Returns the DuckDB engine version, caching the first result for reuse.
 *
 * @param conn - active DuckDB connection used to query the version
 * @returns DuckDB version string
 */
async function getDuckDbVersion(conn: DuckDBConnection): Promise<string> {
  if (!dbVersionCache) {
    const versionRes = await conn.run('SELECT version();');
    const rows = await versionRes.getRows();
    dbVersionCache = (rows[0][0] as string) || 'unknown';
  }

  return dbVersionCache;
}

/**
 * Loads the DuckDB extensions required for Iceberg access.
 * In development it installs extensions dynamically; in deployed environments
 * it loads the pre-bundled extension binaries.
 *
 * @param conn - active DuckDB connection used to install/load extensions
 */
async function loadDuckDbExtensions(conn: DuckDBConnection): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    await conn.run('INSTALL httpfs; LOAD httpfs;');
    await conn.run('INSTALL iceberg; LOAD iceberg;');
    await conn.run('INSTALL aws; LOAD aws;');
    return;
  }

  const dbVersion = await getDuckDbVersion(conn);
  const extPath = '/app/.duckdb_extensions';
  const extBase = `${extPath}/${dbVersion}/linux_arm64`;
  await conn.run(`SET extension_directory='${extPath}';`);

  await conn.run('LOAD parquet;');
  await conn.run('LOAD avro;');
  await conn.run(`LOAD '${extBase}/httpfs.duckdb_extension';`);
  await conn.run(`LOAD '${extBase}/iceberg.duckdb_extension';`);
  await conn.run(`LOAD '${extBase}/aws.duckdb_extension';`);
}

/**
 * Applies per-connection DuckDB runtime settings for S3 access, memory usage,
 * worker threads, and metadata/object caching.
 *
 * @param conn - active DuckDB connection to configure
 */
async function applyDuckDbConnectionSettings(conn: DuckDBConnection): Promise<void> {
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
}

/**
 * Moves the session back to the in-memory database and detaches the shared
 * Glue-backed Iceberg catalog if present.
 *
 * @param conn - active DuckDB connection used to detach the catalog
 */
async function detachGlueCatalog(conn: DuckDBConnection): Promise<void> {
  await conn.run('USE memory.main;');
  try {
    await conn.run('DETACH glue_iceberg;');
  } catch (error) {
    log.warn('Detach failed (likely already detached by another connection)', error);
  }
}

/**
 * Checks whether the shared `glue_iceberg` catalog is already registered in
 * the DuckDB instance.
 *
 * @param conn - active DuckDB connection used to inspect registered databases
 * @returns true when the catalog is already attached
 */
async function isGlueCatalogPresent(conn: DuckDBConnection): Promise<boolean> {
  const checkRes = await conn.run("SELECT count(*) FROM duckdb_databases() WHERE database_name = 'glue_iceberg';");
  const rows = await checkRes.getRows();
  return (rows[0][0] as number) > 0;
}

/**
 * Attaches the AWS Glue Iceberg catalog, tolerating concurrent attach attempts
 * from other connections in the same DuckDB instance.
 *
 * @param conn - active DuckDB connection used to attach the catalog
 * @param awsAccountId - AWS account ID used as the Glue catalog target
 */
async function attachGlueCatalog(conn: DuckDBConnection, awsAccountId: string): Promise<void> {
  try {
    await conn.run(
      `ATTACH '${awsAccountId}' AS glue_iceberg (TYPE iceberg, ENDPOINT_TYPE 'glue');`
    );
    isGlueAttached = true;
  } catch (error) {
    if (await isGlueCatalogPresent(conn)) {
      log.warn('ATTACH failed but catalog is already present (concurrent attach).');
      isGlueAttached = true;
      return;
    }

    log.error('Failed to attach glue_iceberg catalog and it is not present.', error);
  }
}

/**
 * Re-populates shared cache state after credentials are rotated and the catalog
 * is re-attached, provided cache warmup is enabled and already initialized.
 *
 * @param conn - active DuckDB connection used for cache warmup queries
 * @param wasRefreshed - whether AWS credentials were refreshed in this cycle
 */
function warmInstanceCacheAfterRefresh(conn: DuckDBConnection, wasRefreshed: boolean): void {
  // Only re-warm if the secret actually changed and we aren't already warming
  if (!wasRefreshed || !ENABLE_CACHE_WARMUP) return;

  log.info('Re-warming instance-wide cache in background after secret refresh...');

  // Use a timeout to let the primary query "win" the metadata race first
  setTimeout(() => {
    populateInstanceCache(conn).catch((error) => {
      log.warn('Background re-warm failed', error);
    });
  }, 1000);
}

/**
 * Ensures that the shared Glue catalog is attached and refreshed after secret
 * rotation when necessary.
 *
 * @param conn - active DuckDB connection used for catalog maintenance
 * @param awsAccountId - AWS account ID used as the Glue catalog target
 * @param wasRefreshed - whether AWS credentials were refreshed in this cycle
 */
async function ensureGlueCatalog(
  conn: DuckDBConnection,
  awsAccountId: string,
  wasRefreshed: boolean
): Promise<void> {
  if (!wasRefreshed && isGlueAttached) {
    return;
  }

  let didRefreshCatalogForCurrentSecret = false;

  await withGlueCatalogMaintenance(async () => {
    const secretRefreshTime = lastSecretRefresh;
    const needsCatalogRefreshForCurrentSecret = wasRefreshed
      && secretRefreshTime > lastCatalogRefreshForSecretAt;

    if (!needsCatalogRefreshForCurrentSecret && isGlueAttached) {
      return;
    }

    const catalogPresent = await isGlueCatalogPresent(conn);

    if (needsCatalogRefreshForCurrentSecret && catalogPresent) {
      log.info('Refreshing catalog attachment due to credential rotation.');
      await detachGlueCatalog(conn);
      await attachGlueCatalog(conn, awsAccountId);

      if (isGlueAttached) {
        lastCatalogRefreshForSecretAt = secretRefreshTime;
        didRefreshCatalogForCurrentSecret = true;
      }
      return;
    }

    if (!catalogPresent) {
      await attachGlueCatalog(conn, awsAccountId);

      if (isGlueAttached && needsCatalogRefreshForCurrentSecret) {
        lastCatalogRefreshForSecretAt = secretRefreshTime;
        didRefreshCatalogForCurrentSecret = true;
      }
      return;
    }

    isGlueAttached = true;

    if (needsCatalogRefreshForCurrentSecret) {
      lastCatalogRefreshForSecretAt = secretRefreshTime;
    }
  });

  warmInstanceCacheAfterRefresh(conn, didRefreshCatalogForCurrentSecret);
}

/**
 * Switches the session to the configured schema within the shared Glue Iceberg
 * catalog.
 *
 * @param conn - active DuckDB connection whose search path should be updated
 * @param glueSchema - Glue schema/namespace to use
 */
async function useGlueSchema(conn: DuckDBConnection, glueSchema: string): Promise<void> {
  await conn.run(`USE glue_iceberg.${quoteIdent(glueSchema)};`);
}

/**
 * Verifies that the configured Glue schema is accessible. If schema selection
 * fails, it forces a detach/attach cycle and retries once.
 *
 * @param conn - active DuckDB connection used to validate schema access
 * @param awsAccountId - AWS account ID used as the Glue catalog target
 * @param glueSchema - Glue schema/namespace that should be accessible
 */
async function ensureGlueSchemaAccessible(
  conn: DuckDBConnection,
  awsAccountId: string,
  glueSchema: string
): Promise<void> {
  try {
    await useGlueSchema(conn, glueSchema);
  } catch (error) {
    log.warn('USE schema failed. Forcing a clean re-attach.', error);
    await withGlueCatalogMaintenance(async () => {
      const catalogPresent = await isGlueCatalogPresent(conn);

      if (!catalogPresent) {
        await attachGlueCatalog(conn, awsAccountId);
      }

      try {
        await useGlueSchema(conn, glueSchema);
      } catch (retryError) {
        log.warn('Retrying USE schema after attach-only recovery failed; performing a clean re-attach.', retryError);
        await detachGlueCatalog(conn);
        await attachGlueCatalog(conn, awsAccountId);
        await useGlueSchema(conn, glueSchema);
      }
    });
  }
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
  const awsAccountId = getRequiredEnv('AWS_ACCOUNT_ID');
  const glueSchema = getRequiredEnv('ICEBERG_NAMESPACE');

  await loadDuckDbExtensions(conn);
  await applyDuckDbConnectionSettings(conn);

  await conn.run('CALL load_aws_credentials();');
  const wasRefreshed = await ensureFreshSecret(conn);

  await ensureGlueCatalog(conn, awsAccountId, wasRefreshed);
  await ensureGlueSchemaAccessible(conn, awsAccountId, glueSchema);
}

/**
 * Creates a new DuckDB connection from the shared instance and fully configures it.
 */
async function getConnection(): Promise<DuckDBConnection> {
  const connection = await instance!.connect();
  await configureConnection(connection);
  return connection;
}

/**
 * Forces the next connection configuration flow to recreate the DuckDB AWS
 * secret instead of reusing the cached refresh timestamp.
 */
export function forceSecretRefresh(): void {
  lastSecretRefresh = 0;
}

/**
 * Rebuilds the idle DuckDB connection pool by closing all idle connections and
 * recreating replacements up to the configured pool size budget.
 *
 * In-use connections are left untouched and continue serving active queries.
 */
export async function rebuildDuckDbConnectionPool(): Promise<void> {
  if (refreshPoolPromise) {
    await refreshPoolPromise;
    return;
  }

  refreshPoolPromise = (async () => {
    const startTime = Date.now();
    let closedIdleCount = 0;
    let replacementSuccessCount = 0;

    log.info(
      `Rebuilding DuckDB connection pool (${connectionPool.length} idle connections will be replaced).`
    );

    while (connectionPool.length > 0) {
      const pooledConn = connectionPool.pop()!;
      try {
        pooledConn.closeSync();
      } catch (error) {
        log.warn('Error closing DuckDB connection during pool rebuild', error);
      } finally {
        closedIdleCount += 1;
      }
    }

    const neededReplacements = Math.max(0, MAX_POOL_SIZE - inUseConnections.size);
    for (let i = 0; i < neededReplacements; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const newConn = await getConnection();
        connectionPool.push(newConn);
        replacementSuccessCount += 1;
      } catch (error) {
        log.error('Failed to create DuckDB connection during pool rebuild', error);
      }
    }

    log.info(
      'DuckDB pool rebuild complete. '
      + `${closedIdleCount} idle closed, ${replacementSuccessCount} replacements created, `
      + `in ${Date.now() - startTime}ms.`
    );
  })().finally(() => {
    refreshPoolPromise = undefined;
  });

  await refreshPoolPromise;
}

/**
 * Start one-time background cache population using a single connection.
 * Since DuckDB caches are instance-wide, doing this once benefits the whole pool.
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
      log.info('Starting background cache warmup using a single DuckDB connection...');
      // Only use the first connection, as cache is instance-wide
      if (connectionPool.length > 0) {
        await populateInstanceCache(connectionPool[0]);
      }
      log.info('Background cache warmup complete.');
    } catch (error) {
      log.warn('Background cache warmup failed', error);
    } finally {
      isPoolCacheWarmupComplete = true;
    }
  })();
}

/**
 * Start the background job to periodically rebuild the pool.
 */
function startBackgroundConnectionRefresh(): void {
  if (backgroundRefreshInterval) return;
  backgroundRefreshInterval = setInterval(() => {
    rebuildDuckDbConnectionPool().catch((error) => log.error('Error during pool rebuild', error));
  }, POOL_REBUILD_INTERVAL_MS);
}

/**
 * Closes all active and idle DuckDB connections.
 *
 * @param context - The context in which the connections are being closed (for logging).
 */
function closeAllConnections(context: string): void {
  const allConnections = [...connectionPool, ...inUseConnections];
  connectionPool.length = 0;
  inUseConnections.clear();

  for (const conn of allConnections) {
    try {
      conn.closeSync();
    } catch (error) {
      log.warn(`Error closing DuckDB connection during ${context}`, error);
    }
  }
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

      // Connections must be initialized sequentially to avoid catalog write-write
      // conflicts in DuckDB (for example, concurrent CREATE SECRET calls).
      for (let i = 0; i < MAX_POOL_SIZE; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        connectionPool.push(await getConnection());
      }

      startPoolCacheWarmup();
      startBackgroundConnectionRefresh();

      log.info(`DuckDB initialized with a pool of ${connectionPool.length}/${MAX_POOL_SIZE} connections.`);
    } catch (error) {
      log.error('Failed to initialize DuckDB:', error);
      closeAllConnections('initialization failure');
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

  while (connectionPool.length > 0) {
    const conn = connectionPool.pop()!;
    inUseConnections.add(conn);
    return conn;
  }

  const conn = await getConnection();
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
  pooledConnections: DuckDBConnection[];
}): void {
  instance = params.instance;
  initPromise = Promise.resolve();
  poolCacheWarmupPromise = undefined;
  isPoolCacheWarmupComplete = true;
  isGlueAttached = true;
  lastCatalogRefreshForSecretAt = lastSecretRefresh;
  glueCatalogMaintenanceChain = Promise.resolve();
  connectionPool.length = 0;
  connectionPool.push(...params.pooledConnections);
  inUseConnections.clear();
}

/**
 * Release a connection back to the pool for reuse.
 *
 * @param conn
 */
export async function releaseDuckDbConnection(conn: DuckDBConnection): Promise<void> {
  if (!inUseConnections.has(conn)) {
    log.error('Double release detected for DuckDB connection. Ignoring to prevent pool corruption.');
    return;
  }
  inUseConnections.delete(conn);

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
  closeAllConnections('shutdown');
  instance = undefined;
  initPromise = undefined;
  dbVersionCache = undefined;
  poolCacheWarmupPromise = undefined;
  isPoolCacheWarmupComplete = false;
  isGlueAttached = false;
  lastCatalogRefreshForSecretAt = 0;
  glueCatalogMaintenanceChain = Promise.resolve();
}
