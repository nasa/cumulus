/* eslint-disable unicorn/no-null */
const test = require('ava');

const cryptoRandomString = require('crypto-random-string');

const { migrationDir } = require('../../dist');

const testDbName = `provider_${cryptoRandomString({ length: 10 })}`;

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

test('ProviderPgModel.upsert() creates new provider', async (t) => {
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

test('ProviderPgModel.upsert() creates provider with allowed_redirects', async (t) => {
  const {
    knex,
    providerPgModel,
    providerRecord,
  } = t.context;

  const updatedRecord = {
    ...providerRecord,
    allowed_redirects: ['test.com', 'fake.com:53'],
  };

  await providerPgModel.upsert(knex, updatedRecord);
  const actualRecord = await providerPgModel.get(knex, updatedRecord);
  t.like(
    actualRecord,
    updatedRecord
  );
});

test('ProviderPgModel.upsert() creates provider with max_download_time', async (t) => {
  const {
    knex,
    providerPgModel,
    providerRecord,
  } = t.context;

  const updatedRecord = {
    ...providerRecord,
    max_download_time: 600,
  };

  await providerPgModel.upsert(knex, updatedRecord);
  const actualRecord = await providerPgModel.get(knex, updatedRecord);
  t.like(
    actualRecord,
    updatedRecord
  );
});
