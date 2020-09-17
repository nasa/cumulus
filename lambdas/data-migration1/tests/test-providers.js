const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const path = require('path');
const test = require('ava');

const Provider = require('@cumulus/api/models/providers');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');

const {
  migrateProviderRecord
} = require('../dist/lambda');

const testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

const generateFakeProvider = (params) => ({
  id: cryptoRandomString({ length: 10 }),
  globalConnectionLimit: 1,
  protocol: 'http',
  host: `${cryptoRandomString({ length: 10 })}host`,
  port: 80,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  username: `${cryptoRandomString({ length: 5 })}user`,
  password: `${cryptoRandomString({ length: 5 })}pass`,
  encrypted: false,
  privateKey: 'key',
  cmKeyId: 'key-id',
  certificateUri: 'uri',
  ...params,
});

let providersModel;

test.before(async (t) => {
  t.context.knexAdmin = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      migrationDir: `${path.join(__dirname, '..', '..', 'db-migration', 'dist', 'lambda', 'migrations')}`,
    },
  });

  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });
  process.env.ProvidersTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  providersModel = new Provider();
  await providersModel.createTable();

  await t.context.knexAdmin.raw(`create database "${testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${testDbName}" to "${testDbUser}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      migrationDir: `${path.join(__dirname, '..', '..', 'db-migration', 'dist', 'lambda', 'migrations')}`,
    },
  });

  await t.context.knex.migrate.latest();
});

test.afterEach.always(async (t) => {
  await t.context.knex('providers').del();
});

test.after.always(async (t) => {
  await providersModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test.serial('migrateProviderRecord correctly migrates provider record', async (t) => {
  const fakeProvider = generateFakeProvider();
  const cumulusId = await migrateProviderRecord(fakeProvider, t.context.knex);
  const [createdRecord] = await t.context.knex.queryBuilder()
    .select()
    .table('providers')
    .where('cumulusId', cumulusId);

  t.deepEqual(
    omit(createdRecord, ['cumulusId']),
    omit(
      {
        ...fakeProvider,
        name: fakeProvider.id,
        created_at: new Date(fakeProvider.createdAt),
        updated_at: new Date(fakeProvider.updatedAt),
      },
      ['id', 'createdAt', 'updatedAt']
    )
  );
});
