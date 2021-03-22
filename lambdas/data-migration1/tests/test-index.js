const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const uuid = require('uuid/v4');

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
} = require('@cumulus/db');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { handler } = require('../dist/lambda');

let asyncOperationsModel;
let collectionsModel;
let providersModel;
let rulesModel;

const testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
const workflow = cryptoRandomString({ length: 10 });

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  process.env.AsyncOperationsTable = cryptoRandomString({ length: 10 });
  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.ProvidersTable = cryptoRandomString({ length: 10 });
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const messageTemplateKey = `${process.env.stackName}/workflow_template.json`;
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
  };

  const createKeyResponse = await KMS.createKey();
  process.env.provider_kms_key_id = createKeyResponse.KeyMetadata.KeyId;

  asyncOperationsModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });
  collectionsModel = new Collection();
  providersModel = new Provider();
  rulesModel = new Rule();

  await asyncOperationsModel.createTable();
  await collectionsModel.createTable();
  await providersModel.createTable();
  await rulesModel.createTable();

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
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});

test.afterEach.always(async (t) => {
  await t.context.knex('rules').del();
  await t.context.knex('providers').del();
  await t.context.knex('collections').del();
  await t.context.knex('async_operations').del();
});

test.after.always(async (t) => {
  await providersModel.deleteTable();
  await collectionsModel.deleteTable();
  await rulesModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.only('handler migrates async operations, collections, providers, rules', async (t) => {
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
    id: uuid(),
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
    rule: { type: 'onetime', value: cryptoRandomString({ length: 10 }), arn: cryptoRandomString({ length: 10 }), logEventArn: cryptoRandomString({ length: 10 }) },
    executionNamePrefix: cryptoRandomString({ length: 10 }),
    meta: { key: 'value' },
    queueUrl: cryptoRandomString({ length: 10 }),
    payload: { result: { key: 'value' } },
    tags: ['tag1', 'tag2'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await Promise.all([
    collectionsModel.create(fakeCollection),
    asyncOperationsModel.create(fakeAsyncOperation),
    providersModel.create(fakeProvider),
    rulesModel.create(fakeRule),
  ]);

  t.teardown(() => Promise.all([
    rulesModel.delete(fakeRule),
    providersModel.delete(fakeProvider),
    asyncOperationsModel.delete({ id: fakeAsyncOperation.id }),
    collectionsModel.delete(fakeCollection),
  ]));

  const call = await handler({});
  const expected = `
      Migration summary:
        Collections:
          Out of 1 DynamoDB records:
            1 records migrated
            0 records skipped
            0 records failed
        Providers:
          Out of 1 DynamoDB records:
            1 records migrated
            0 records skipped
            0 records failed
        AsyncOperations:
          Out of 1 DynamoDB records:
            1 records migrated
            0 records skipped
            0 records failed
        Rules:
          Out of 1 DynamoDB records:
            1 records migrated
            0 records skipped
            0 records failed
    `;
  t.is(call, expected);
});
