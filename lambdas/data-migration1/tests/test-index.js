const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { v4: uuidv4 } = require('uuid');

const AsyncOperation = require('@cumulus/api/models/async-operation');
const Collection = require('@cumulus/api/models/collections');
const Provider = require('@cumulus/api/models/providers');
const Rule = require('@cumulus/api/models/rules');
const KMS = require('@cumulus/aws-client/KMS');

const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  RulePgModel,
} = require('@cumulus/db');

const { handler } = require('../dist/lambda');

const workflow = cryptoRandomString({ length: 10 });

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    stackName: cryptoRandomString({ length: 10 }),
    system_bucket: cryptoRandomString({ length: 10 }),
    AsyncOperationsTable: cryptoRandomString({ length: 10 }),
    CollectionsTable: cryptoRandomString({ length: 10 }),
    ProvidersTable: cryptoRandomString({ length: 10 }),
    RulesTable: cryptoRandomString({ length: 10 }),
  };

  await createBucket(process.env.system_bucket);

  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const messageTemplateKey = `${process.env.stackName}/workflow_template.json`;

  const createKeyResponse = await KMS.createKey();
  process.env.provider_kms_key_id = createKeyResponse.KeyMetadata.KeyId;

  t.context.asyncOperationsModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });
  t.context.collectionsModel = new Collection();
  t.context.providersModel = new Provider();
  t.context.rulesModel = new Rule();

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
  await Promise.all([
    t.context.asyncOperationsModel.createTable(),
    t.context.collectionsModel.createTable(),
    t.context.providersModel.createTable(),
    t.context.rulesModel.createTable(),
  ]);

  t.context.testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  t.context.rulePgModel = new RulePgModel();

  process.env = {
    ...process.env,
    PG_DATABASE: t.context.testDbName,
  };
});

test.afterEach.always(async (t) => {
  await t.context.rulesModel.deleteTable();
  await t.context.providersModel.deleteTable();
  await t.context.collectionsModel.deleteTable();
  await t.context.asyncOperationsModel.deleteTable();
  await destroyLocalTestDb(t.context);
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('handler migrates async operations, collections, providers, rules', async (t) => {
  const {
    asyncOperationsModel,
    collectionsModel,
    providersModel,
    rulesModel,
  } = t.context;

  const fakeCollection = {
    name: `${cryptoRandomString({ length: 10 })}collection`,
    version: '0.0.0',
    duplicateHandling: 'replace',
    granuleId: '^MOD09GQ\\.A[\\d]{7}\.[\\S]{6}\\.006\\.[\\d]{13}$',
    granuleIdExtraction: '(MOD09GQ\\.(.*))\\.hdf',
    sampleFileName: 'MOD09GQ.A2017025.h21v00.006.2017034065104.hdf',
    files: [{ regex: '^.*\\.txt$', sampleFileName: 'file.txt', bucket: 'bucket' }],
    meta: { foo: 'bar', key: { value: 'test' } },
    reportToEms: false,
    ignoreFilesConfigForDiscovery: false,
    process: 'modis',
    url_path: 'path',
    tags: ['tag1', 'tag2'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const fakeAsyncOperation = {
    id: uuidv4(),
    description: 'unittest async operation',
    operationType: 'ES Index',
    output: '{ "output": "test" }',
    status: 'SUCCEEDED',
    taskArn: 'arn:aws:ecs:task:1234',
    createdAt: (Date.now() - 1000),
    updatedAt: Date.now(),
  };

  const fakeProvider = {
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
  };

  const fakeRule = {
    name: cryptoRandomString({ length: 10 }),
    workflow: workflow,
    provider: undefined,
    state: 'DISABLED',
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    rule: { type: 'onetime' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const ruleWithTrigger = await rulesModel.createRuleTrigger(fakeRule);
  await Promise.all([
    collectionsModel.create(fakeCollection),
    asyncOperationsModel.create(fakeAsyncOperation),
    providersModel.create(fakeProvider),
    rulesModel.create(ruleWithTrigger),
  ]);

  t.teardown(() => Promise.all([
    rulesModel.delete(fakeRule),
    providersModel.delete(fakeProvider),
    asyncOperationsModel.delete({ id: fakeAsyncOperation.id }),
  ]).then(() => collectionsModel.delete(fakeCollection)));

  const call = await handler({});
  const expected = {
    MigrationSummary: {
      async_operations: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
      collections: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
      providers: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
      rules: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
    },
  };
  t.deepEqual(call, expected);
});

test.serial('handler passes along forceRulesMigration parameter correctly', async (t) => {
  const {
    collectionsModel,
    providersModel,
    rulesModel,
    knex,
    rulePgModel,
  } = t.context;

  const fakeCollection = {
    name: `${cryptoRandomString({ length: 10 })}collection`,
    version: '0.0.0',
    duplicateHandling: 'replace',
    granuleId: '^MOD09GQ\\.A[\\d]{7}\.[\\S]{6}\\.006\\.[\\d]{13}$',
    granuleIdExtraction: '(MOD09GQ\\.(.*))\\.hdf',
    sampleFileName: 'MOD09GQ.A2017025.h21v00.006.2017034065104.hdf',
    files: [{ regex: '^.*\\.txt$', sampleFileName: 'file.txt', bucket: 'bucket' }],
  };

  const fakeProvider = {
    id: cryptoRandomString({ length: 10 }),
    protocol: 's3',
    host: `${cryptoRandomString({ length: 10 })}host`,
  };

  const fakeRule = {
    name: cryptoRandomString({ length: 10 }),
    workflow: workflow,
    provider: fakeProvider.name,
    state: 'DISABLED',
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    rule: { type: 'onetime' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await Promise.all([
    collectionsModel.create(fakeCollection),
    providersModel.create(fakeProvider),
    rulesModel.createRuleTrigger(fakeRule)
      .then((ruleWithTrigger) => rulesModel.create(ruleWithTrigger)),
  ]);

  t.teardown(() => Promise.all([
    rulesModel.delete(fakeRule),
    providersModel.delete(fakeProvider),
  ]).then(() => collectionsModel.delete(fakeCollection)));

  // migrate records for the first time
  await handler({});

  const records = await rulePgModel.search(
    knex,
    {}
  );
  t.is(records.length, 1);

  // re-migrate and force rules migration
  const call = await handler({
    forceRulesMigration: true,
  });
  const expected = {
    MigrationSummary: {
      async_operations: {
        failed: 0,
        migrated: 0,
        skipped: 0,
        total_dynamo_db_records: 0,
      },
      collections: {
        failed: 0,
        migrated: 0,
        skipped: 1,
        total_dynamo_db_records: 1,
      },
      providers: {
        failed: 0,
        migrated: 0,
        skipped: 1,
        total_dynamo_db_records: 1,
      },
      rules: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
    },
  };
  t.deepEqual(call, expected);
  const migratedRecords = await rulePgModel.search(
    knex,
    {}
  );
  t.is(migratedRecords.length, 1);
});
