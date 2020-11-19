/* eslint-disable max-len */
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const test = require('ava');

const KMS = require('@cumulus/aws-client/KMS');
const Collection = require('@cumulus/api/models/collections');
const Provider = require('@cumulus/api/models/providers');
const Rule = require('@cumulus/api/models/rules');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { fakeCollectionFactory, fakeProviderFactory } = require('@cumulus/api/lib/testUtils');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');

const { migrateCollectionRecord } = require('../dist/lambda/collections');
const { migrateProviderRecord } = require('../dist/lambda/providers');

const {
  migrateRuleRecord,
  migrateRules,
} = require('../dist/lambda/rules');
const { RecordAlreadyMigrated } = require('../dist/lambda/errors');
// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { fake } = require('sinon');

const testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

const generateFakeRule = (collectionName, collectionVersion, providerId) => ({
  name: cryptoRandomString({ length: 10 }),
  workflow: 'workflow-name',
  provider: providerId,
  state: 'ENABLED',
  collection: {
    name: collectionName,
    version: collectionVersion,
  },
  rule: { type: 'scheduled', arn: 'some-arn' },
  meta: undefined,
  payload: undefined,
  queueUrl: undefined,
  tags: undefined,
  executionNamePrefix: undefined,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

let collectionsModel;
let providersModel;
let rulesModel;
let fakeCollection;
let fakeProvider;

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });
  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.ProvidersTable = cryptoRandomString({ length: 10 });
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  const createKeyResponse = await KMS.createKey();
  process.env.provider_kms_key_id = createKeyResponse.KeyMetadata.KeyId;
  t.context.providerKmsKeyId = process.env.provider_kms_key_id;

  await createBucket(process.env.system_bucket);

  collectionsModel = new Collection();
  await collectionsModel.createTable();

  providersModel = new Provider();
  await providersModel.createTable();

  rulesModel = new Rule();
  await rulesModel.createTable();

  fakeCollection = fakeCollectionFactory();
  fakeProvider = fakeProviderFactory({
    encrypted: false,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  t.context.knexAdmin = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      migrationDir,
    },
  });
  await t.context.knexAdmin.raw(`create database "${testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${testDbName}" to "${testDbUser}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      migrationDir,
    },
  });

  await t.context.knex.migrate.latest();
});

test.afterEach.always(async (t) => {
  await t.context.knex('rules').del();
  await t.context.knex('providers').del();
  await t.context.knex('collections').del();
});

test.after.always(async (t) => {
  await collectionsModel.deleteTable();
  await providersModel.deleteTable();
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test.serial('migrateRuleRecord correctly migrates rule record', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeRule = generateFakeRule(fakeCollection.name, fakeCollection.version, fakeProvider.id);

  await migrateCollectionRecord(fakeCollection, knex);
  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  await migrateRuleRecord(fakeRule, knex);

  const createdRecord = await t.context.knex.queryBuilder()
    .select()
    .table('rules')
    .where({ name: fakeRule.name })
    .first();

  t.deepEqual(
    omit(createdRecord, ['cumulusId', 'collectionCumulusId', 'providerCumulusId']),
    omit(
      {
        ...fakeRule,
        arn: fakeRule.rule.arn,
        type: fakeRule.rule.type,
        value: fakeRule.rule.value ? fakeRule.rule.value : null,
        enabled: true,
        logEventArn: null,
        executionNamePrefix: null,
        payload: null,
        queueUrl: null,
        meta: null,
        tags: null,
        created_at: new Date(fakeRule.createdAt),
        updated_at: new Date(fakeRule.updatedAt),
      },
      ['createdAt', 'updatedAt', 'state', 'provider', 'collection', 'rule']
    )
  );
});

test.serial('migrateRuleRecord throws error on invalid source data from Dynamo', async (t) => {
  const fakeRule = generateFakeRule(fakeCollection.name, fakeCollection.version, fakeProvider.id);

  // make source record invalid
  delete fakeRule.files;

  await t.throwsAsync(migrateRuleRecord(fakeRule, t.context.knex));
});

test.serial('migrateRuleRecord handles nullable fields on source rule data', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeRule = generateFakeRule(fakeCollection.name, fakeCollection.version, fakeProvider.id);

  // remove nullable fields
  delete fakeRule.rule.value;
  delete fakeRule.rule.arn;
  delete fakeRule.payload;
  delete fakeRule.logEventArn;
  delete fakeRule.queueUrl;
  delete fakeRule.meta;
  delete fakeRule.tags;

  await migrateCollectionRecord(fakeCollection, knex);
  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  await migrateRuleRecord(fakeRule, t.context.knex);
  const createdRecord = await t.context.knex.queryBuilder()
    .select()
    .table('rules')
    .where({ name: fakeRule.name })
    .first();

  t.deepEqual(
    omit(createdRecord, ['cumulusId', 'collectionCumulusId', 'providerCumulusId']),
    omit(
      {
        ...fakeRule,
        arn: fakeRule.rule.arn ? fakeRule.rule.arn : null,
        value: fakeRule.rule.value ? fakeRule.rule.value : null,
        type: fakeRule.rule.type,
        enabled: true,
        logEventArn: null,
        executionNamePrefix: null,
        payload: null,
        queueUrl: null,
        meta: null,
        tags: null,
        created_at: new Date(fakeRule.createdAt),
        updated_at: new Date(fakeRule.updatedAt),
      },
      ['createdAt', 'updatedAt', 'state', 'provider', 'collection', 'rule']
    )
  );
});
