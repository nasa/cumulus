'use strict';

const isFunction = require('lodash/isFunction');
const noop = require('lodash/noop');
const test = require('ava');
const sinon = require('sinon');
// noCallThru prevents proxyquire from loading the real @duckdb/node-api binary,
// which requires native addons not available in the test environment.
const proxyquire = require('proxyquire').noCallThru();
const loadedIcebergModules = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake DuckDBConnection with minimal SQL-aware run() behavior. */
const makeFakeConnection = () => {
  let glueAttached = false;

  return {
    closeSync: noop,
    run: sinon.stub().callsFake((sql) => {
      if (/duckdb_databases\(\)/i.test(sql)) {
        return {
          getRows: () => [[glueAttached ? 1 : 0]],
        };
      }

      if (/attach\s+'.*'\s+as\s+glue_iceberg/.test(sql)) {
        glueAttached = true;
      }

      return undefined;
    }),
  };
};

/**
 * Build a fake DuckDBInstance.
 * @param {object} [connTemplate] - optionally share a single connection across all connect() calls
 */
const makeFakeInstance = (connTemplate) => ({
  connect: sinon.stub().callsFake(() => Promise.resolve(connTemplate ?? makeFakeConnection())),
});

/**
 * Build a stub for `DuckDBInstance.create` that resolves with the given instance.
 * Returns both the proxyquire-ready module object and the raw stub for assertions.
 */
const makeDuckDBStub = (instanceOverride) => {
  const fakeInst = instanceOverride ?? makeFakeInstance();
  const createStub = sinon.stub().resolves(fakeInst);
  return {
    duckdbModule: { DuckDBInstance: { create: createStub } },
    createStub,
    fakeInst,
  };
};

/**
 * Load a fresh, isolated copy of iceberg-connection with the supplied DuckDB stub.
 * Each call produces independent module-level state (instance, pool, flags).
 */
const loadIcebergModule = (duckdbModule) => {
  const icebergModule = proxyquire('../dist/iceberg-connection', {
    '@duckdb/node-api': duckdbModule,
  });

  loadedIcebergModules.push(icebergModule);
  return icebergModule;
};

// ---------------------------------------------------------------------------
// Shared env setup – use development mode so getConnection skips
// the production extension-path logic and SELECT version() call.
// ---------------------------------------------------------------------------
test.before(() => {
  process.env.NODE_ENV = 'development';
  process.env.AWS_ACCOUNT_ID = '123456789012';
  process.env.ICEBERG_NAMESPACE = 'test_schema';
  process.env.AWS_REGION = 'us-east-1';
});

test.after(() => {
  delete process.env.NODE_ENV;
  delete process.env.AWS_ACCOUNT_ID;
  delete process.env.ICEBERG_NAMESPACE;
  delete process.env.AWS_REGION;
});

test.afterEach.always(async () => {
  while (loadedIcebergModules.length > 0) {
    const icebergModule = loadedIcebergModules.pop();
    if (icebergModule?.destroyDuckDb) {
      // eslint-disable-next-line no-await-in-loop
      await icebergModule.destroyDuckDb();
    }
  }
});

// ---------------------------------------------------------------------------
// 1. Concurrent callers during initialization
// ---------------------------------------------------------------------------

test.serial('concurrent initializeDuckDb calls invoke DuckDBInstance.create exactly once', async (t) => {
  const { duckdbModule, createStub } = makeDuckDBStub();
  const { initializeDuckDb } = loadIcebergModule(duckdbModule);

  // Fire N concurrent calls – only the first should proceed past the guard
  await Promise.all(Array.from({ length: 8 }, () => initializeDuckDb()));

  t.is(createStub.callCount, 1, 'DuckDBInstance.create must be called exactly once');
});

test.serial('repeated sequential initializeDuckDb calls after success are no-ops', async (t) => {
  const { duckdbModule, createStub } = makeDuckDBStub();
  const { initializeDuckDb } = loadIcebergModule(duckdbModule);

  await initializeDuckDb();
  await initializeDuckDb();
  await initializeDuckDb();

  t.is(createStub.callCount, 1);
});

// ---------------------------------------------------------------------------
// 2. Connection pool – reuse and discard
// ---------------------------------------------------------------------------

test.serial('acquireDuckDbConnection returns a connection from the pool after init', async (t) => {
  const sharedConn = makeFakeConnection();
  const fakeInst = makeFakeInstance(sharedConn);
  const { duckdbModule } = makeDuckDBStub(fakeInst);
  const { initializeDuckDb, acquireDuckDbConnection } = loadIcebergModule(duckdbModule);

  await initializeDuckDb();
  const conn = await acquireDuckDbConnection();

  t.truthy(conn, 'should return a connection object');
  const runTarget = conn.connection ? conn.connection : conn;
  t.true(isFunction(runTarget.run), 'returned connection must expose run()');
});

test.serial('released connection is re-acquired on next acquireDuckDbConnection call', async (t) => {
  const sharedConn = makeFakeConnection();
  const fakeInst = makeFakeInstance(sharedConn);
  const { duckdbModule } = makeDuckDBStub(fakeInst);
  const {
    initializeDuckDb,
    acquireDuckDbConnection,
    releaseDuckDbConnection,
  } = loadIcebergModule(duckdbModule);

  await initializeDuckDb();

  const first = await acquireDuckDbConnection();
  await releaseDuckDbConnection(first);
  const second = await acquireDuckDbConnection();

  t.is(first, second, 'the same connection object should be recycled from the pool');
});

test.serial('releaseDuckDbConnection discards connections when pool is at MAX_POOL_SIZE', async (t) => {
  const fakeInst = makeFakeInstance();
  const { duckdbModule } = makeDuckDBStub(fakeInst);
  const {
    initializeDuckDb,
    acquireDuckDbConnection,
    releaseDuckDbConnection,
  } = loadIcebergModule(duckdbModule);

  await initializeDuckDb();

  // Drain the entire pool
  const maxPool = Number(process.env.DUCKDB_MAX_POOL) || 3;
  const drained = [];
  for (let i = 0; i < maxPool; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    drained.push(await acquireDuckDbConnection());
  }

  // Return all but one, filling the pool back to MAX_POOL_SIZE
  for (let i = 0; i < maxPool - 1; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await releaseDuckDbConnection(drained[i]);
  }

  // Track connect() calls from this point
  const connectCallsBefore = fakeInst.connect.callCount;

  // This release should be discarded (pool already full)
  await releaseDuckDbConnection(drained[maxPool - 1]);

  // Acquiring now should pull from pool, not create a new connection
  await acquireDuckDbConnection();
  t.is(
    fakeInst.connect.callCount,
    connectCallsBefore,
    'no new connection should be created – pool was already full before the extra release'
  );
});

// ---------------------------------------------------------------------------
// 3. acquireDuckDbConnection triggers lazy initialization
// ---------------------------------------------------------------------------

test.serial('acquireDuckDbConnection initializes DuckDB if not yet initialized', async (t) => {
  const { duckdbModule, createStub } = makeDuckDBStub();
  const { acquireDuckDbConnection } = loadIcebergModule(duckdbModule);

  // Call acquire WITHOUT calling initializeDuckDb first
  const conn = await acquireDuckDbConnection();

  t.is(createStub.callCount, 1, 'DuckDB should be lazily initialized on first acquire');
  t.truthy(conn);
});

// ---------------------------------------------------------------------------
// 4. Init failure resets state so callers can retry
// ---------------------------------------------------------------------------

test.serial('failed initializeDuckDb resets instance so a subsequent call retries', async (t) => {
  const initError = new Error('Simulated Glue catalog ATTACH failure');
  const failStub = sinon.stub().rejects(initError);

  // First stub: always fails
  const failingModule = { DuckDBInstance: { create: failStub } };
  const { initializeDuckDb: initFailing } = loadIcebergModule(failingModule);

  await t.throwsAsync(
    () => initFailing(),
    { message: initError.message },
    'initializeDuckDb should propagate the underlying error'
  );
});

test.serial('after init failure, a second initializeDuckDb attempt calls DuckDBInstance.create again', async (t) => {
  // Produce two separate module instances so the global stub can be swapped.
  // We simulate: first call fails, second call (fresh module copy) succeeds.

  const firstError = new Error('first attempt failure');
  const failingStub = sinon.stub().rejects(firstError);
  const failModule = { DuckDBInstance: { create: failingStub } };
  const { initializeDuckDb: initFail } = loadIcebergModule(failModule);

  // First attempt should reject
  await t.throwsAsync(() => initFail(), { message: firstError.message });
  t.is(failingStub.callCount, 1);

  // Simulate retry: same module is re-used; stub now succeeds
  const fakeInst = makeFakeInstance();
  failingStub.reset();
  failingStub.resolves(fakeInst);

  // Should succeed now because instance is undefined and isInitializing is false after failure
  await t.notThrowsAsync(() => initFail());
  t.is(failingStub.callCount, 1, 'create should be called exactly once on the retry');
});

// ---------------------------------------------------------------------------
// 5. destroyDuckDb resets all state
// ---------------------------------------------------------------------------

test.serial('destroyDuckDb clears pool and instance so reinit starts fresh', async (t) => {
  const { duckdbModule, createStub } = makeDuckDBStub();
  const { initializeDuckDb, destroyDuckDb } = loadIcebergModule(duckdbModule);

  await initializeDuckDb();
  t.is(createStub.callCount, 1);

  await destroyDuckDb();

  // After destroy, init should start from scratch
  await initializeDuckDb();
  t.is(createStub.callCount, 2, 'DuckDBInstance.create should be called again after destroy');
});

// ---------------------------------------------------------------------------
// 6. Missing env vars throw descriptive errors
// ---------------------------------------------------------------------------

test.serial('initializeDuckDb throws if AWS_ACCOUNT_ID is missing', async (t) => {
  const { duckdbModule } = makeDuckDBStub();
  const { initializeDuckDb } = loadIcebergModule(duckdbModule);

  const saved = process.env.AWS_ACCOUNT_ID;
  delete process.env.AWS_ACCOUNT_ID;
  t.teardown(() => {
    process.env.AWS_ACCOUNT_ID = saved;
  });

  await t.throwsAsync(
    () => initializeDuckDb(),
    { message: /AWS_ACCOUNT_ID environment variable is required/ }
  );
});

test.serial('initializeDuckDb throws if ICEBERG_NAMESPACE is missing', async (t) => {
  const { duckdbModule } = makeDuckDBStub();
  const { initializeDuckDb } = loadIcebergModule(duckdbModule);

  const saved = process.env.ICEBERG_NAMESPACE;
  delete process.env.ICEBERG_NAMESPACE;
  t.teardown(() => {
    process.env.ICEBERG_NAMESPACE = saved;
  });

  await t.throwsAsync(
    () => initializeDuckDb(),
    { message: /ICEBERG_NAMESPACE environment variable is required/ }
  );
});

// ---------------------------------------------------------------------------
// 7. Background connection refresh
// ---------------------------------------------------------------------------

test.serial('background connection refresh replaces stale connections', async (t) => {
  const clock = sinon.useFakeTimers({
    now: Date.now(),
    shouldAdvanceTime: true,
  });
  t.teardown(() => clock.restore());

  const fakeInst = makeFakeInstance();
  const { duckdbModule } = makeDuckDBStub(fakeInst);
  const icebergModule = loadIcebergModule(duckdbModule);

  await icebergModule.initializeDuckDb();

  const maxPool = Number(process.env.DUCKDB_MAX_POOL) || 3;
  t.is(fakeInst.connect.callCount, maxPool, 'Initial connections created');

  // Advance time past the 5-hour threshold and wait for setInterval callbacks
  // 6 hours in milliseconds
  await clock.tickAsync(6 * 60 * 60 * 1000);

  // Stale connections should be removed and replaced by new connections
  t.is(
    fakeInst.connect.callCount,
    maxPool * 2,
    'New connections should be created to replace stale ones'
  );
});

test.serial('concurrent acquires after forceSecretRefresh perform only one catalog detach/refresh cycle', async (t) => {
  const sharedState = { glueAttached: false };
  let detachCount = 0;

  const makeSharedConnection = () => ({
    closeSync: noop,
    run: sinon.stub().callsFake((sql) => {
      if (/duckdb_databases\(\)/i.test(sql)) {
        return {
          getRows: () => [[sharedState.glueAttached ? 1 : 0]],
        };
      }

      if (/attach\s+'.*'\s+as\s+glue_iceberg/i.test(sql)) {
        sharedState.glueAttached = true;
      }

      if (/detach\s+glue_iceberg/i.test(sql)) {
        detachCount += 1;
        sharedState.glueAttached = false;
      }

      return undefined;
    }),
  });

  const fakeInst = {
    connect: sinon.stub().callsFake(() => Promise.resolve(makeSharedConnection())),
  };

  const { duckdbModule } = makeDuckDBStub(fakeInst);
  const {
    initializeDuckDb,
    acquireDuckDbConnection,
    forceSecretRefresh,
  } = loadIcebergModule(duckdbModule);

  await initializeDuckDb();

  const maxPool = Number(process.env.DUCKDB_MAX_POOL) || 3;
  await Promise.all(Array.from({ length: maxPool }, () => acquireDuckDbConnection()));

  forceSecretRefresh();

  await Promise.all(Array.from({ length: 6 }, () => acquireDuckDbConnection()));

  t.is(detachCount, 1, 'catalog detach/refresh should run once for one secret-refresh event');
});
