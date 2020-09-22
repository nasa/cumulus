const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const path = require('path');
const test = require('ava');

const Provider = require('@cumulus/api/models/providers');
const Rule = require('@cumulus/api/models/rules');
const KMS = require('@cumulus/aws-client/KMS');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const {
  createBucket,
  putFile,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { S3KeyPairProvider } = require('@cumulus/common/key-pair-provider');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');

const {
  migrateProviderRecord,
  migrateProviders,
} = require('../dist/lambda/providers');
const { RecordAlreadyMigrated } = require('../dist/lambda/errors');

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
let rulesModel;

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
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  await putFile(
    process.env.system_bucket,
    `${process.env.stackName}/crypto/public.pub`,
    require.resolve('@cumulus/test-data/keys/s3_key_pair_provider_public.pub')
  );

  await putFile(
    process.env.system_bucket,
    `${process.env.stackName}/crypto/private.pem`,
    require.resolve('@cumulus/test-data/keys/s3_key_pair_provider_private.pem')
  );

  const createKeyResponse = await KMS.createKey();
  process.env.provider_kms_key_id = createKeyResponse.KeyMetadata.KeyId;
  t.context.providerKmsKeyId = process.env.provider_kms_key_id;

  providersModel = new Provider();
  await providersModel.createTable();

  rulesModel = new Rule();
  await rulesModel.createTable();

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
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test.serial('migrateProviderRecord correctly migrates provider record', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeProvider = generateFakeProvider();
  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  const createdRecord = await knex.queryBuilder()
    .select()
    .table('providers')
    .where('name', fakeProvider.id)
    .first();

  t.deepEqual(
    omit(
      {
        ...createdRecord,
        username: await KMS.decryptBase64String(createdRecord.username),
        password: await KMS.decryptBase64String(createdRecord.password),
      },
      ['cumulusId']
    ),
    omit(
      {
        ...fakeProvider,
        name: fakeProvider.id,
        created_at: new Date(fakeProvider.createdAt),
        updated_at: new Date(fakeProvider.updatedAt),
        encrypted: true,
      },
      ['id', 'createdAt', 'updatedAt']
    )
  );
});

test.serial('migrateProviderRecord correctly migrates record without credentials', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeProvider = generateFakeProvider({
    encrypted: false,
  });

  delete fakeProvider.username;
  delete fakeProvider.password;

  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  const createdRecord = await knex.queryBuilder()
    .select()
    .table('providers')
    .where('name', fakeProvider.id)
    .first();

  t.is(createdRecord.encrypted, false);
  t.is(createdRecord.username, null);
  t.is(createdRecord.password, null);
});

test.serial('migrateProviderRecord throws error for un-decryptable credentials', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeProvider = generateFakeProvider({
    encrypted: true,
    username: 'not-encrypted',
    password: 'not-encrypted',
  });

  await t.throwsAsync(migrateProviderRecord(fakeProvider, providerKmsKeyId, knex));
});

test.serial('migrateProviderRecord correctly encrypts plaintext credentials', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const username = 'my-username';
  const password = 'my-password';

  const fakeProvider = generateFakeProvider({
    encrypted: false,
    username,
    password,
  });

  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  const createdRecord = await knex.queryBuilder()
    .select()
    .table('providers')
    .where('name', fakeProvider.id)
    .first();

  t.is(createdRecord.encrypted, true);
  t.is(await KMS.decryptBase64String(createdRecord.username), 'my-username');
  t.is(await KMS.decryptBase64String(createdRecord.password), 'my-password');
});

test.serial('migrateProviderRecord correctly encrypts S3KeyPairProvider-encrypted credentials', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const username = await S3KeyPairProvider.encrypt('my-username');
  const password = await S3KeyPairProvider.encrypt('my-password');

  const s3EncryptedProvider = generateFakeProvider({
    encrypted: true,
    username,
    password,
  });

  await migrateProviderRecord(s3EncryptedProvider, providerKmsKeyId, knex);
  const createdRecord = await knex.queryBuilder()
    .select()
    .table('providers')
    .where('name', s3EncryptedProvider.id)
    .first();

  t.is(createdRecord.encrypted, true);
  t.is(await KMS.decryptBase64String(createdRecord.username), 'my-username');
  t.is(await KMS.decryptBase64String(createdRecord.password), 'my-password');
});

test.serial('migrateProviderRecord correctly preserves KMS-encrypted credentials', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const username = await KMS.encrypt(providerKmsKeyId, 'my-username');
  const password = await KMS.encrypt(providerKmsKeyId, 'my-password');

  const KMSEncryptedProvider = generateFakeProvider({
    encrypted: true,
    username,
    password,
  });

  await migrateProviderRecord(KMSEncryptedProvider, providerKmsKeyId, knex);
  const createdRecord = await knex.queryBuilder()
    .select()
    .table('providers')
    .where('name', KMSEncryptedProvider.id)
    .first();

  t.is(createdRecord.encrypted, true);
  t.is(await KMS.decryptBase64String(createdRecord.username), 'my-username');
  t.is(await KMS.decryptBase64String(createdRecord.password), 'my-password');
});

test.serial('migrateProviderRecord throws error on invalid source data from Dynamo', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeProvider = generateFakeProvider();

  // make source record invalid
  delete fakeProvider.id;

  await t.throwsAsync(migrateProviderRecord(fakeProvider, providerKmsKeyId, knex));
});

test.serial('migrateProviderRecord handles nullable fields on source collection data', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeProvider = generateFakeProvider();

  // remove nullable fields
  delete fakeProvider.port;
  delete fakeProvider.username;
  delete fakeProvider.password;
  delete fakeProvider.encrypted;
  delete fakeProvider.privateKey;
  delete fakeProvider.cmKeyId;
  delete fakeProvider.certificateUri;
  delete fakeProvider.updatedAt;

  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  const createdRecord = await knex.queryBuilder()
    .select()
    .table('providers')
    .where('name', fakeProvider.id)
    .first();

  // ensure updated_at was set
  t.false(Number.isNaN(Date.parse(createdRecord.updated_at)));
  t.deepEqual(
    omit(createdRecord, ['cumulusId', 'updated_at']),
    omit(
      {
        ...fakeProvider,
        name: fakeProvider.id,
        port: null,
        username: null,
        password: null,
        encrypted: null,
        privateKey: null,
        cmKeyId: null,
        certificateUri: null,
        created_at: new Date(fakeProvider.createdAt),
      },
      ['id', 'createdAt', 'updatedAt']
    )
  );
});

test.serial('migrateProviderRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeProvider = generateFakeProvider();

  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  await t.throwsAsync(
    migrateProviderRecord(fakeProvider, providerKmsKeyId, knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateProviders skips already migrated record', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeProvider = generateFakeProvider();

  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  await providersModel.create(fakeProvider);
  t.teardown(() => providersModel.delete(fakeProvider));
  const migrationSummary = await migrateProviders(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 1,
    skipped: 1,
    failed: 0,
    success: 0,
  });
  const records = await knex.queryBuilder().select().table('providers');
  t.is(records.length, 1);
});

test.serial('migrateProviders processes multiple providers', async (t) => {
  const { knex } = t.context;
  const fakeProvider1 = generateFakeProvider();
  const fakeProvider2 = generateFakeProvider();

  await Promise.all([
    providersModel.create(fakeProvider1),
    providersModel.create(fakeProvider2),
  ]);
  t.teardown(() => Promise.all([
    providersModel.delete(fakeProvider1),
    providersModel.delete(fakeProvider2),
  ]));

  const migrationSummary = await migrateProviders(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 0,
    success: 2,
  });
  const records = await knex.queryBuilder().select().table('providers');
  t.is(records.length, 2);
});

test.serial('migrateProviders processes all non-failing records', async (t) => {
  const { knex } = t.context;
  const fakeProvider1 = generateFakeProvider();
  const fakeProvider2 = generateFakeProvider();

  // remove required source field so that record will fail
  delete fakeProvider1.host;

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.ProvidersTable,
      Item: fakeProvider1,
    }).promise(),
    providersModel.create(fakeProvider2),
  ]);
  t.teardown(() => Promise.all([
    providersModel.delete(fakeProvider1),
    providersModel.delete(fakeProvider2),
  ]));

  const migrationSummary = await migrateProviders(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 1,
    success: 1,
  });
  const records = await knex.queryBuilder().select().table('providers');
  t.is(records.length, 1);
});
