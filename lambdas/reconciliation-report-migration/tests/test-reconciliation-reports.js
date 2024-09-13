const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const test = require('ava');

const ReconciliationReport = require('@cumulus/api/models/reconciliation-reports');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const {
  generateLocalTestDb,
  destroyLocalTestDb,
  ReconciliationReportPgModel,
} = require('@cumulus/db');
const { RecordAlreadyMigrated } = require('@cumulus/errors');

const {
  migrateReconciliationReportRecord,
  migrateReconciliationReports,
} = require('../dist/lambda/reconciliation-reports');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');

const testDbName = `reconciliation_reports_migration_${cryptoRandomString({ length: 10 })}`;

const generateFakeReconciliationReport = (params) => ({
  name: cryptoRandomString({ length: 5 }),
  type: 'Granule Inventory',
  status: 'Generated',
  error: {},
  createdAt: (Date.now() - 1000),
  updatedAt: Date.now(),
  ...params,
});

let reconciliationReportsModel;

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });
  process.env.ReconciliationReportsTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  reconciliationReportsModel = new ReconciliationReport({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });
  await reconciliationReportsModel.createTable();

  t.context.reconciliationReportPgModel = new ReconciliationReportPgModel();

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});

test.afterEach.always(async (t) => {
  await t.context.knex('reconciliation_reports').del();
});

test.after.always(async (t) => {
  await reconciliationReportsModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.serial('migrateReconciliationReportRecord correctly migrates reconciliationReport record', async (t) => {
  const { knex, reconciliationReportPgModel } = t.context;

  const fakeReconReport = generateFakeReconciliationReport();
  await migrateReconciliationReportRecord(fakeReconReport, t.context.knex);

  const createdRecord = await reconciliationReportPgModel.get(
    knex,
    { name: fakeReconReport.name }
  );

  t.deepEqual(
    omit(createdRecord, ['cumulus_id']),
    omit({
      ...fakeReconReport,
      created_at: new Date(fakeReconReport.createdAt),
      updated_at: new Date(fakeReconReport.updatedAt),
    }, ['createdAt', 'updatedAt'])
  );
});

test.serial('migrateReconciliationReportRecord correctly migrates reconciliationReport record where record.error is an object', async (t) => {
  const error = { exception: 'there is an error' };
  const fakeReconReport = generateFakeReconciliationReport({ error });
  await migrateReconciliationReportRecord(fakeReconReport, t.context.knex);

  const createdRecord = await t.context.knex.queryBuilder()
    .select()
    .table('reconciliation_reports')
    .where({ name: fakeReconReport.name })
    .first();

  t.deepEqual(
    omit(createdRecord, ['cumulus_id']),
    omit({
      ...fakeReconReport,
      created_at: new Date(fakeReconReport.createdAt),
      updated_at: new Date(fakeReconReport.updatedAt),
    }, ['createdAt', 'updatedAt'])
  );
});

test.serial('migrateReconciliationReportRecord migrates reconciliationReport record with undefined nullables', async (t) => {
  const { knex, reconciliationReportPgModel } = t.context;

  const fakeReconReport = generateFakeReconciliationReport();
  delete fakeReconReport.output;
  delete fakeReconReport.taskArn;
  await migrateReconciliationReportRecord(fakeReconReport, t.context.knex);

  const createdRecord = await reconciliationReportPgModel.get(
    knex,
    { name: fakeReconReport.name }
  );

  t.deepEqual(
    omit(createdRecord, ['cumulus_id']),
    omit({
      ...fakeReconReport,
      error: null,
      created_at: new Date(fakeReconReport.createdAt),
      updated_at: new Date(fakeReconReport.updatedAt),
    }, ['createdAt', 'updatedAt'])
  );
});

test.serial('migrateReconciliationReportRecord throws RecordAlreadyMigrated error if already migrated record is newer', async (t) => {
  const fakeReconReport = generateFakeReconciliationReport({
    updatedAt: Date.now(),
  });

  await migrateReconciliationReportRecord(fakeReconReport, t.context.knex);

  const olderFakeReconReport = {
    ...fakeReconReport,
    updatedAt: Date.now() - 1000, // older than fakeReconReport
  };

  await t.throwsAsync(
    migrateReconciliationReportRecord(olderFakeReconReport, t.context.knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateReconciliationReportRecord updates an already migrated record if the updated date is newer', async (t) => {
  const { knex, reconciliationReportPgModel } = t.context;

  const fakeReconReport = generateFakeReconciliationReport({
    updatedAt: Date.now() - 1000,
  });
  await migrateReconciliationReportRecord(fakeReconReport, t.context.knex);

  const newerFakeReconReport = generateFakeReconciliationReport({
    ...fakeReconReport,
    updatedAt: Date.now(),
  });
  await migrateReconciliationReportRecord(newerFakeReconReport, t.context.knex);

  const createdRecord = await reconciliationReportPgModel.get(
    knex,
    { name: fakeReconReport.name }
  );

  t.deepEqual(createdRecord.updated_at, new Date(newerFakeReconReport.updatedAt));
});

test.serial('migrateReconciliationReports processes multiple reconciliation reports', async (t) => {
  const { knex, reconciliationReportPgModel } = t.context;

  const fakeReconReport1 = generateFakeReconciliationReport();
  const fakeReconReport2 = generateFakeReconciliationReport();

  await Promise.all([
    reconciliationReportsModel.create(fakeReconReport1),
    reconciliationReportsModel.create(fakeReconReport2),
  ]);
  t.teardown(() => Promise.all([
    reconciliationReportsModel.delete({ name: fakeReconReport1.id }),
    reconciliationReportsModel.delete({ name: fakeReconReport2.id }),
  ]));

  const migrationSummary = await migrateReconciliationReports(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 0,
    success: 2,
  });

  const records = await reconciliationReportPgModel.search(
    knex,
    {}
  );
  t.is(records.length, 2);
});

test.serial('migrateReconciliationReports processes all non-failing records', async (t) => {
  const { knex, reconciliationReportPgModel } = t.context;

  const fakeReconReport1 = generateFakeReconciliationReport();
  const fakeReconReport2 = generateFakeReconciliationReport();

  // remove required source field so that record will fail
  delete fakeReconReport1.status;

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.ReconciliationReportsTable,
      Item: fakeReconReport1,
    }).promise(),
    reconciliationReportsModel.create(fakeReconReport2),
  ]);
  t.teardown(() => Promise.all([
    reconciliationReportsModel.delete({ name: fakeReconReport1.id }),
    reconciliationReportsModel.delete({ name: fakeReconReport2.id }),
  ]));

  const migrationSummary = await migrateReconciliationReports(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 1,
    success: 1,
  });
  const records = await reconciliationReportPgModel.search(
    knex,
    {}
  );
  t.is(records.length, 1);
});
