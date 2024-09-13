const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const ReconciliationReport = require('@cumulus/api/models/reconciliation_reports');

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
const testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
const workflow = cryptoRandomString({ length: 10 });

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    stackName: cryptoRandomString({ length: 10 }),
    system_bucket: cryptoRandomString({ length: 10 }),
    ReconciliationReportsTable: cryptoRandomString({ length: 10 }),
  };

  await createBucket(process.env.system_bucket);

  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const messageTemplateKey = `${process.env.stackName}/workflow_template.json`;

  t.context.reconciliationReportsModel = new ReconciliationReport({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });

  await Promise.all([
    t.context.reconciliationReportsModel.createTable(),
  ]);

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

test.after.always(async (t) => {
  await t.context.reconciliationReportsModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('handler migrates reconciliation reports', async (t) => {
  const { reconciliationReportsModel } = t.context;

  const fakeReconciliationReport = {
    name: cryptoRandomString({ length: 5 }),
    type: 'Granule Inventory',
    status: 'Generated',
    error: {},
    createdAt: (Date.now() - 1000),
    updatedAt: Date.now(),
  };

  await Promise.all([
    reconciliationReportsModel.create(fakeReconciliationReport),
  ]);

  t.teardown(() => reconciliationReportsModel.delete({ id: fakeReconciliationReport.id }));

  const call = await handler({});
  const expected = {
    MigrationSummary: {
      failed: 0,
      migrated: 1,
      skipped: 0,
      total_dynamo_db_records: 1,
    },
  };
  t.deepEqual(call, expected);
});
