/* eslint-disable max-len */
const Collection = require('@cumulus/api/models/collections');
const cryptoRandomString = require('crypto-random-string');
const KMS = require('@cumulus/aws-client/KMS');
const omit = require('lodash/omit');
const Provider = require('@cumulus/api/models/providers');
const Rule = require('@cumulus/api/models/rules');
const test = require('ava');

const { createBucket, putJsonS3Object, recursivelyDeleteS3Bucket} = require('@cumulus/aws-client/S3');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { createSqsQueues, fakeCollectionFactory, fakeProviderFactory } = require('@cumulus/api/lib/testUtils');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { randomId, randomString } = require('@cumulus/common/test-utils');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { migrateCollectionRecord } = require('../dist/lambda/collections');
const { migrateProviderRecord } = require('../dist/lambda/providers');
const { migrateRuleRecord, migrateRules } = require('../dist/lambda/rules');
const { RecordAlreadyMigrated } = require('../dist/lambda/errors');

const testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';
const workflow = randomId('workflow-');

const generateFakeRule = (collectionName, collectionVersion, providerId, enabled = true) => ({
  name: cryptoRandomString({ length: 10 }),
  workflow: workflow,
  provider: providerId,
  state: enabled ? 'ENABLED' : 'DISABLED',
  collection: {
    name: collectionName,
    version: collectionVersion,
  },
  rule: { type: 'onetime' },
  meta: { key: 'value' },
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

  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const messageTemplateKey = `${process.env.stackName}/workflow_template.json`;

  collectionsModel = new Collection();
  await collectionsModel.createTable();

  providersModel = new Provider();
  await providersModel.createTable();

  rulesModel = new Rule();
  await rulesModel.createTable();
  await createBucket(process.env.system_bucket);

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

  await Promise.all([
    putJsonS3Object(
      process.env.system_bucket,
      messageTemplateKey,
      { meta: 'meta' }
    ),
    putJsonS3Object(
      process.env.system_bucket,
      workflowfile,
      { testworkflow: 'workflow-config' }
    ),
  ]);
});

test.afterEach.always(async (t) => {
  await t.context.knex('rules').del();
  await t.context.knex('providers').del();
  await t.context.knex('collections').del();
});

test.after.always(async (t) => {
  await providersModel.deleteTable();
  await collectionsModel.deleteTable();
  await rulesModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test.serial('migrateRuleRecord correctly migrates rule record', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  fakeCollection = fakeCollectionFactory();
  fakeProvider = fakeProviderFactory({
    encrypted: false,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
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
        arn: fakeRule.rule.arn ? fakeRule.rule.arn : null,
        type: fakeRule.rule.type,
        value: fakeRule.rule.value ? fakeRule.rule.value : null,
        enabled: true,
        logEventArn: null,
        executionNamePrefix: null,
        payload: null,
        queueUrl: null,
        tags: null,
        created_at: new Date(fakeRule.createdAt),
        updated_at: new Date(fakeRule.updatedAt),
      },
      ['createdAt', 'updatedAt', 'state', 'provider', 'collection', 'rule']
    )
  );
});

test.serial('migrateRuleRecord throws error on invalid source data from DynamoDb', async (t) => {
  fakeCollection = fakeCollectionFactory();
  fakeProvider = fakeProviderFactory({
    encrypted: false,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const fakeRule = generateFakeRule(fakeCollection.name, fakeCollection.version, fakeProvider.id);

  // make source record invalid
  delete fakeRule.files;

  await t.throwsAsync(migrateRuleRecord(fakeRule, t.context.knex));
});

test.serial('migrateRuleRecord handles nullable fields on source rule data', async (t) => {
  fakeCollection = fakeCollectionFactory();
  fakeProvider = fakeProviderFactory({
    encrypted: false,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const { knex, providerKmsKeyId } = t.context;
  const fakeRule = generateFakeRule(fakeCollection.name, fakeCollection.version, fakeProvider.id);

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

test.serial('migrateRuleRecord ignores extraneous fields from Dynamo', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  fakeCollection = fakeCollectionFactory();
  fakeProvider = fakeProviderFactory({
    encrypted: false,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const fakeRule = generateFakeRule(fakeCollection.name, fakeCollection.version, fakeProvider.id);

  fakeRule.state = 'ENABLED';
  await migrateCollectionRecord(fakeCollection, knex);
  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  await t.notThrowsAsync(migrateRuleRecord(fakeRule, knex));
});

test.serial('migrateRuleRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeRule = generateFakeRule(fakeCollection.name, fakeCollection.version, fakeProvider.id);

  await migrateCollectionRecord(fakeCollection, knex);
  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  await migrateRuleRecord(fakeRule, knex);
  await t.throwsAsync(
    migrateRuleRecord(fakeRule, t.context.knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateRules skips already migrated record', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const fakeRule = generateFakeRule(fakeCollection.name, fakeCollection.version, fakeProvider.id);
  const queueUrls = await createSqsQueues(randomString());
  fakeRule.queueUrl = queueUrls.queueUrl;

  await migrateCollectionRecord(fakeCollection, knex);
  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  await migrateRuleRecord(fakeRule, knex);
  await rulesModel.create(fakeRule);

  t.teardown(() => rulesModel.delete(fakeRule));
  const migrationSummary = await migrateRules(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 1,

    skipped: 1,
    failed: 0,
    success: 0,
  });
  const records = await t.context.knex.queryBuilder().select().table('rules');
  t.is(records.length, 1);
});

test.serial('migrateRules processes multiple rules', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const anotherFakeCollection = fakeCollectionFactory();
  const anotherFakeProvider = fakeProviderFactory({
    encrypted: false,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const fakeRule1 = generateFakeRule(fakeCollection.name, fakeCollection.version, fakeProvider.id);
  const fakeRule2 = generateFakeRule(anotherFakeCollection.name, anotherFakeCollection.version, anotherFakeProvider.id);
  const queueUrls1 = await createSqsQueues(randomString());
  const queueUrls2 = await createSqsQueues(randomString());

  await migrateCollectionRecord(fakeCollection, knex);
  await migrateCollectionRecord(anotherFakeCollection, knex);
  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  await migrateProviderRecord(anotherFakeProvider, providerKmsKeyId, knex);

  fakeRule1.queueUrl = queueUrls1.queueUrl;
  fakeRule2.queueUrl = queueUrls2.queueUrl;

  await Promise.all([
    rulesModel.create(fakeRule1),
    rulesModel.create(fakeRule2),
  ]);
  t.teardown(() => Promise.all([
    rulesModel.delete(fakeRule1),
    rulesModel.delete(fakeRule2),
  ]));
  const migrationSummary = await migrateRules(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 0,
    success: 2,
  });
  const records = await t.context.knex.queryBuilder().select().table('rules');
  t.is(records.length, 2);
});

test.serial('migrateRules processes all non-failing records', async (t) => {
  const { knex, providerKmsKeyId } = t.context;
  const anotherFakeCollection = fakeCollectionFactory();
  const anotherFakeProvider = fakeProviderFactory({
    encrypted: false,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const fakeRule1 = generateFakeRule(fakeCollection.name, fakeCollection.version, fakeProvider.id);
  const fakeRule2 = generateFakeRule(anotherFakeCollection.name, anotherFakeCollection.version, anotherFakeProvider.id);
  await migrateCollectionRecord(fakeCollection, knex);
  await migrateCollectionRecord(anotherFakeCollection, knex);
  await migrateProviderRecord(fakeProvider, providerKmsKeyId, knex);
  await migrateProviderRecord(anotherFakeProvider, providerKmsKeyId, knex);

  // remove required source field so that record will fail
  delete fakeRule1.state;

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.RulesTable,
      Item: fakeRule1,
    }).promise(),
    rulesModel.create(fakeRule2),
  ]);
  t.teardown(() => Promise.all([
    rulesModel.delete(fakeRule1),
    rulesModel.delete(fakeRule2),
  ]));
  const migrationSummary = await migrateRules(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 1,
    success: 1,
  });
  const records = await t.context.knex.queryBuilder().select().table('rules');
  t.is(records.length, 1);
});
