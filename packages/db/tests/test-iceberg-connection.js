const test = require('ava');
const { KnexTimeoutError } = require('knex');

const {
  initializeIcebergKnexClientSingleton,
  getKnexClientSingleton,
  destroyIcebergKnexClientSingleton,
} = require('../dist/iceberg-connection');
const { localStackConnectionEnv } = require('../dist/config');

test.serial('initializeIcebergKnexClientSingleton creates and reuses singleton',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = { ...localStackConnectionEnv };

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

test.serial('getKnexClientSingleton returns singleton in Iceberg API mode',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = { ...localStackConnectionEnv };

    const client1 = await getKnexClientSingleton({ env });
    const client2 = await getKnexClientSingleton({ env });

    // Should return the same instance
    t.is(client1, client2);

    await destroyIcebergKnexClientSingleton();
  });

test.serial('getKnexClientSingleton returns new client in Lambda mode',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = { ...localStackConnectionEnv };
    // No DEPLOY_ICEBERG_API = Lambda mode

    const client1 = await getKnexClientSingleton({ env });
    const client2 = await getKnexClientSingleton({ env });

    // Should return different instances in Lambda mode
    t.not(client1, client2);

    // Clean up
    await client1.destroy();
    await client2.destroy();
  });

test.serial('getKnexClientSingleton sets default pool size for Iceberg API',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = { ...localStackConnectionEnv };

    const client = await getKnexClientSingleton({ env });

    // Check that pool max is set to 50 (default for Iceberg API)
    t.is(client.client.pool.max, 50);

    await destroyIcebergKnexClientSingleton();
  });

test.serial('getKnexClientSingleton respects custom dbMaxPool setting',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = {
      ...localStackConnectionEnv,
      dbMaxPool: '25',
    };

    const client = await getKnexClientSingleton({ env });

    // Check that pool max is set to custom value
    t.is(client.client.pool.max, 25);

    await destroyIcebergKnexClientSingleton();
  });

test.serial('destroyIcebergKnexClientSingleton destroys and resets singleton',
  async (t) => {
    // Clean up any existing singleton
    await destroyIcebergKnexClientSingleton();

    const env = { ...localStackConnectionEnv };

    const client1 = await getKnexClientSingleton({ env });

    await destroyIcebergKnexClientSingleton();

    const client2 = await getKnexClientSingleton({ env });

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