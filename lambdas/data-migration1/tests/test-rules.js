const Collection = require('@cumulus/api/models/collections');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const Provider = require('@cumulus/api/models/providers');
const Rule = require('@cumulus/api/models/rules');
const test = require('ava');

const { createBucket, putJsonS3Object, recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { translateApiCollectionToPostgresCollection, translateApiProviderToPostgresProvider, RulePgModel } = require('@cumulus/db');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { fakeCollectionFactory, fakeProviderFactory } = require('@cumulus/api/lib/testUtils');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { RecordAlreadyMigrated } = require('@cumulus/errors');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { migrateRuleRecord, migrateRules } = require('../dist/lambda/rules');

const testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';
const workflow = randomId('workflow-');
const ruleOmitList = ['createdAt', 'updatedAt', 'state', 'provider', 'collection', 'rule'];

const generateFakeRule = (params) => ({
  name: cryptoRandomString({ length: 10 }),
  workflow: workflow,
  state: 'ENABLED',
  rule: { type: 'onetime', value: randomString(), arn: randomString(), logEventArn: randomString() },
  executionNamePrefix: randomString(),
  meta: { key: 'value' },
  queueUrl: randomString(),
  payload: { result: { key: 'value' } },
  tags: ['tag1', 'tag2'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...params,
});

const migrateFakeCollectionRecord = async (record, knex) => {
  const updatedRecord = translateApiCollectionToPostgresCollection(record);
  await knex('collections').insert(updatedRecord);
};

const fakeEncryptFunction = async () => 'fakeEncryptedString';

const migrateFakeProviderRecord = async (record, knex) => {
  const updatedRecord = await translateApiProviderToPostgresProvider(record, fakeEncryptFunction);
  await knex('providers').insert(updatedRecord);
};

let collectionsModel;
let providersModel;
let rulesModel;

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });
  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.ProvidersTable = cryptoRandomString({ length: 10 });
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const messageTemplateKey = `${process.env.stackName}/workflow_template.json`;

  collectionsModel = new Collection();
  await collectionsModel.createTable();

  providersModel = new Provider();
  await providersModel.createTable();

  rulesModel = new Rule();
  await rulesModel.createTable();
  await createBucket(process.env.system_bucket);

  t.context.rulePgModel = new RulePgModel();

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

test.beforeEach(async (t) => {
  const fakeCollection = fakeCollectionFactory();
  const fakeProvider = fakeProviderFactory({
    encrypted: true,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: new Date(2020, 11, 17),
  });

  t.context.fakeCollection = fakeCollection;
  t.context.fakeProvider = fakeProvider;
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
  const { knex, fakeCollection, fakeProvider, rulePgModel } = t.context;
  const fakeRule = generateFakeRule({
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    provider: fakeProvider.id,
  });

  await migrateFakeCollectionRecord(fakeCollection, knex);
  await migrateFakeProviderRecord(fakeProvider, knex);
  await migrateRuleRecord(fakeRule, knex);

  const createdRecord = await rulePgModel.get(
    knex,
    { name: fakeRule.name }
  );

  t.deepEqual(
    omit(createdRecord, ['cumulus_id', 'collection_cumulus_id', 'provider_cumulus_id']),
    omit(
      {
        name: fakeRule.name,
        workflow: fakeRule.workflow,
        meta: fakeRule.meta,
        arn: fakeRule.rule.arn,
        type: fakeRule.rule.type,
        value: fakeRule.rule.value,
        enabled: true,
        log_event_arn: fakeRule.rule.logEventArn,
        execution_name_prefix: fakeRule.executionNamePrefix,
        payload: fakeRule.payload,
        queue_url: fakeRule.queueUrl,
        tags: fakeRule.tags,
        created_at: new Date(fakeRule.createdAt),
        updated_at: new Date(fakeRule.updatedAt),
      },
      ruleOmitList
    )
  );
});

test.serial('migrateRuleRecord throws error on invalid source data from DynamoDb', async (t) => {
  const { fakeCollection, fakeProvider } = t.context;
  const fakeRule = generateFakeRule({
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    provider: fakeProvider.id,
  });

  // make source record invalid
  delete fakeRule.workflow;

  await t.throwsAsync(
    migrateRuleRecord(fakeRule, t.context.knex),
    { name: 'SchemaValidationError' }
  );
});

test.serial('migrateRuleRecord handles nullable fields on source rule data', async (t) => {
  const { knex, fakeCollection, fakeProvider, rulePgModel } = t.context;
  const fakeRule = generateFakeRule({
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    provider: fakeProvider.id,
  });

  delete fakeRule.rule.logEventArn;
  delete fakeRule.rule.value;
  delete fakeRule.rule.arn;
  delete fakeRule.payload;
  delete fakeRule.queueUrl;
  delete fakeRule.meta;
  delete fakeRule.tags;
  delete fakeRule.executionNamePrefix;
  delete fakeRule.collection;
  delete fakeRule.provider;

  await migrateFakeCollectionRecord(fakeCollection, knex);
  await migrateFakeProviderRecord(fakeProvider, knex);
  await migrateRuleRecord(fakeRule, t.context.knex);
  const createdRecord = await rulePgModel.get(
    knex,
    { name: fakeRule.name }
  );

  t.deepEqual(
    omit(createdRecord, ['cumulus_id', 'collection_cumulus_id', 'provider_cumulus_id']),
    omit(
      {
        ...fakeRule,
        arn: fakeRule.rule.arn ? fakeRule.rule.arn : null,
        value: fakeRule.rule.value ? fakeRule.rule.value : null,
        type: fakeRule.rule.type,
        enabled: true,
        log_event_arn: null,
        execution_name_prefix: null,
        payload: null,
        queue_url: null,
        meta: null,
        tags: null,
        created_at: new Date(fakeRule.createdAt),
        updated_at: new Date(fakeRule.updatedAt),
      },
      ruleOmitList
    )
  );
});

test.serial('migrateRuleRecord throws RecordAlreadyMigrated error if already migrated record is newer', async (t) => {
  const { knex, fakeCollection, fakeProvider } = t.context;
  const fakeRule = generateFakeRule({
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    provider: fakeProvider.id,
    updatedAt: Date.now(),
  });

  await migrateFakeCollectionRecord(fakeCollection, knex);
  await migrateFakeProviderRecord(fakeProvider, knex);
  await migrateRuleRecord(fakeRule, knex);

  const olderFakeRule = {
    ...fakeRule,
    updatedAt: Date.now() - 1000,
  };

  await t.throwsAsync(
    migrateRuleRecord(olderFakeRule, t.context.knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateRuleRecord updates an already migrated record if the updated timestamp on incoming record is newer', async (t) => {
  const { knex, fakeCollection, fakeProvider, rulePgModel } = t.context;
  const fakeRule = generateFakeRule({
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    provider: fakeProvider.id,
    updatedAt: Date.now() - 1000,
  });

  await migrateFakeCollectionRecord(fakeCollection, knex);
  await migrateFakeProviderRecord(fakeProvider, knex);
  await migrateRuleRecord(fakeRule, knex);

  const newerFakeRule = generateFakeRule({
    ...fakeRule,
    updatedAt: Date.now(),
  });
  await migrateRuleRecord(newerFakeRule, knex);

  const createdRecord = await rulePgModel.get(
    knex,
    { name: fakeRule.name }
  );

  t.deepEqual(
    omit(createdRecord, ['cumulus_id', 'collection_cumulus_id', 'provider_cumulus_id']),
    omit(
      {
        name: fakeRule.name,
        workflow: fakeRule.workflow,
        meta: fakeRule.meta,
        arn: fakeRule.rule.arn,
        type: fakeRule.rule.type,
        value: fakeRule.rule.value,
        enabled: true,
        log_event_arn: fakeRule.rule.logEventArn,
        execution_name_prefix: fakeRule.executionNamePrefix,
        payload: fakeRule.payload,
        queue_url: fakeRule.queueUrl,
        tags: fakeRule.tags,
        created_at: new Date(fakeRule.createdAt),
        updated_at: new Date(newerFakeRule.updatedAt),
      },
      ruleOmitList
    )
  );
});

test.serial('migrateRules skips already migrated record', async (t) => {
  const { knex, fakeCollection, fakeProvider, rulePgModel } = t.context;
  const fakeRule = generateFakeRule({
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    provider: fakeProvider.id,
  });
  const queueUrls = randomString();
  fakeRule.queueUrl = queueUrls.queueUrl;

  // This always sets updatedAt to Date.now()
  await rulesModel.create(fakeRule);

  // We need to make the updateAt of the record we're about to migrate later
  // than the record in the dynamo table.
  fakeRule.updatedAt = Date.now();

  await migrateFakeCollectionRecord(fakeCollection, knex);
  await migrateFakeProviderRecord(fakeProvider, knex);
  await migrateRuleRecord(fakeRule, knex);

  t.teardown(() => rulesModel.delete(fakeRule));
  const migrationSummary = await migrateRules(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 1,

    skipped: 1,
    failed: 0,
    success: 0,
  });
  const records = await rulePgModel.search(
    knex,
    {}
  );
  t.is(records.length, 1);
});

test.serial('migrateRules processes multiple rules', async (t) => {
  const { knex, fakeCollection, fakeProvider, rulePgModel } = t.context;
  const anotherFakeCollection = fakeCollectionFactory();
  const anotherFakeProvider = fakeProviderFactory({
    encrypted: false,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: new Date(2020, 11, 17),
    updatedAt: new Date(2020, 11, 17),
  });
  const { id } = anotherFakeProvider;
  const { name, version } = anotherFakeCollection;
  const fakeRule1 = generateFakeRule({
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    provider: fakeProvider.id,
  });
  const fakeRule2 = generateFakeRule({
    collection: {
      name: name,
      version: version,
    },
    provider: id,
  });
  const queueUrls1 = randomString();
  const queueUrls2 = randomString();

  await migrateFakeCollectionRecord(fakeCollection, knex);
  await migrateFakeCollectionRecord(anotherFakeCollection, knex);
  await migrateFakeProviderRecord(fakeProvider, knex);
  await migrateFakeProviderRecord(anotherFakeProvider, knex);

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
  const records = await rulePgModel.search(
    knex,
    {}
  );
  t.is(records.length, 2);
});

test.serial('migrateRules processes all non-failing records', async (t) => {
  const { knex, fakeCollection, fakeProvider, rulePgModel } = t.context;
  const anotherFakeCollection = fakeCollectionFactory();
  const anotherFakeProvider = fakeProviderFactory({
    encrypted: false,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: new Date(2020, 11, 17),
    updatedAt: new Date(2020, 11, 17),
  });
  const { id } = anotherFakeProvider;
  const { name, version } = anotherFakeCollection;

  const fakeRule1 = generateFakeRule({
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    provider: fakeProvider.id,
  });
  const fakeRule2 = generateFakeRule({
    collection: {
      name: name,
      version: version,
    },
    provider: id,
  });
  await migrateFakeCollectionRecord(fakeCollection, knex);
  await migrateFakeCollectionRecord(anotherFakeCollection, knex);
  await migrateFakeProviderRecord(fakeProvider, knex);
  await migrateFakeProviderRecord(anotherFakeProvider, knex);

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
  const records = await rulePgModel.search(
    knex,
    {}
  );
  t.is(records.length, 1);
});
