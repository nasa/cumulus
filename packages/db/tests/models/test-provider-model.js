/* eslint-disable unicorn/no-null */
const test = require('ava');

const cryptoRandomString = require('crypto-random-string');

const {
  nullifyUndefinedProviderValues,
} = require('../../dist/provider');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `collection_${cryptoRandomString({ length: 10 })}`;

const {
  ProviderPgModel,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
} = require('../../dist');

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.providerPgModel = new ProviderPgModel();
});

test.beforeEach((t) => {
  t.context.providerRecord = fakeProviderRecordFactory();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('ProviderPgModel.upsert() creates new collection', async (t) => {
  const {
    knex,
    providerPgModel,
    providerRecord,
  } = t.context;

  await providerPgModel.upsert(knex, providerRecord);
  t.like(
    await providerPgModel.get(knex, providerRecord),
    providerRecord
  );
});

test('ProviderPgModel.upsert() overwrites a provider record', async (t) => {
  const {
    knex,
    providerPgModel,
    providerRecord,
  } = t.context;

  await providerPgModel.create(knex, providerRecord);

  const updatedProvider = {
    ...providerRecord,
    host: cryptoRandomString({ length: 10 }),
  };

  await providerPgModel.upsert(knex, updatedProvider);

  t.like(
    await providerPgModel.get(knex, {
      name: providerRecord.name,
    }),
    {
      ...updatedProvider,
      host: updatedProvider.host,
    }
  );
});

test('nullifyUndefinedProviderValues sets undefined provider values to "null"', async (t) => {
  const cumulusProviderObject = {
    name: 'fakeName',
    protocol: 'fakeProtocol',
    host: 'fakeHost',
    port: 'fakePort',
  };

  const expected = {
    name: 'fakeName',
    protocol: 'fakeProtocol',
    host: 'fakeHost',
    port: 'fakePort',
    username: null,
    password: null,
    global_connection_limit: null,
    private_key: null,
    cm_key_id: null,
    certificate_uri: null,
  };

  const actual = nullifyUndefinedProviderValues(cumulusProviderObject);
  t.deepEqual(actual, expected);
});

