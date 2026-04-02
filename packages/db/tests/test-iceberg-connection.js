const test = require('ava');
const { KnexTimeoutError } = require('knex');

const {
  initializeIcebergKnexClientSingleton,
  getIcebergKnexClient,
  destroyIcebergKnexClientSingleton,
} = require('../dist/iceberg-connection');
const { localStackConnectionEnv } = require('../dist/config');

test.serial('initializeIcebergKnexClientSingleton creates and reuses singleton',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = { ...localStackConnectionEnv, DEPLOY_ICEBERG_API: 'true' };

    const client1 = await initializeIcebergKnexClientSingleton({ env });
    const client2 = await initializeIcebergKnexClientSingleton({ env });

    // Should return the same instance
    t.is(client1, client2);

    await destroyIcebergKnexClientSingleton();
  });

test.serial('initializeIcebergKnexClientSingleton handles concurrent calls safely',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = { ...localStackConnectionEnv };

    // Simulate concurrent initialization
    const [client1, client2, client3] = await Promise.all([
      initializeIcebergKnexClientSingleton({ env }),
      initializeIcebergKnexClientSingleton({ env }),
      initializeIcebergKnexClientSingleton({ env }),
    ]);

    // All should return the same instance
    t.is(client1, client2);
    t.is(client2, client3);

    await destroyIcebergKnexClientSingleton();
  });

test.serial('getIcebergKnexClient returns singleton in Iceberg API mode',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = { ...localStackConnectionEnv, DEPLOY_ICEBERG_API: 'true' };

    const client1 = await getIcebergKnexClient({ env });
    const client2 = await getIcebergKnexClient({ env });

    // Should return the same instance
    t.is(client1, client2);

    await destroyIcebergKnexClientSingleton();
  });

test.serial('getIcebergKnexClient sets default pool size for Iceberg API',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = { ...localStackConnectionEnv, DEPLOY_ICEBERG_API: 'true' };

    const client = await getIcebergKnexClient({ env });

    // Check that pool max is set to 50 (default for Iceberg API)
    t.is(client.client.pool.max, 50);

    await destroyIcebergKnexClientSingleton();
  });

test.serial('getIcebergKnexClient respects custom dbMaxPool setting',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = {
      ...localStackConnectionEnv,
      DEPLOY_ICEBERG_API: 'true',
      dbMaxPool: '25',
    };

    const client = await getIcebergKnexClient({ env });

    // Check that pool max is set to custom value
    t.is(client.client.pool.max, 25);

    await destroyIcebergKnexClientSingleton();
  });

test.serial('destroyIcebergKnexClientSingleton destroys and resets singleton',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = { ...localStackConnectionEnv, DEPLOY_ICEBERG_API: 'true' };

    const client1 = await getIcebergKnexClient({ env });

    await destroyIcebergKnexClientSingleton();

    const client2 = await getIcebergKnexClient({ env });

    // Should create a new instance after destroy
    t.not(client1, client2);

    await destroyIcebergKnexClientSingleton();
  });

test.serial('failed initialization clears promise and allows retry',
  async (t) => {
    await destroyIcebergKnexClientSingleton();

    const badEnv = {
      ...localStackConnectionEnv,
      PG_PORT: '9999', // Invalid port
      createTimeoutMillis: 100,
      acquireTimeoutMillis: 100,
    };

    // First attempt: initialize and immediately try a query to force connection failure
    await t.throwsAsync(async () => {
      const instance = await initializeIcebergKnexClientSingleton({ env: badEnv });
      await instance.raw('SELECT 1'); // This forces the actual connection attempt
    }, { instanceOf: KnexTimeoutError });

    // Retry with good config
    const goodEnv = { ...localStackConnectionEnv };
    const client = await initializeIcebergKnexClientSingleton({ env: goodEnv });

    t.truthy(client);
    await destroyIcebergKnexClientSingleton();
  });
