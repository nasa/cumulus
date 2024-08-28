const test = require ('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  ReconciliationReportPgModel,
  fakeReconciliationReportRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
} = require ('../../dist')
// other models?

const testDbName = `rule_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = generateLocalTestDb(
    testDbName,
    migrationDir
  )
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.reconciliationReportPgModel = new ReconciliationReportPgModel();
});

test.beforeEach((t) => {
  t.context.reconciliationReportRecord = fakeReconciliationReportRecordFactory();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('ReconciliationReportPgModel.upsert() creates new reconciliation report' async (t) => {
  const {
    knex,
    reconciliationReportPgModel,
    reconciliationReportRecord,
  } = t.context;

  await reconciliationReportPgModel.upsert(knex, reconciliationReportRecord);

  t.like(
    await reconciliationReportPgModel.get(knex, reconciliationReportRecord),
    reconciliationReportRecord
  );
});

test('ReconciliationReportPgModel.upsert() overwrites a reconciliation report record' async (t) => {
 const {
  knex,
  reconciliationReportPgModel,
  reconciliationReportRecord,
 } = t.context

 await reconciliationReportPgModel.create(knex, reconciliationReportRecord);

 const updatedReconciliationReport = {
  ...reconciliationReportRecord,
  type: 'ORCA Backup',
  status: 'Failed',
 }

 t.like(
  await reconciliationReportPgModel.get(knex, {
    name: reconciliationReportRecord.name,
  }),
  updatedReconciliationReport
 );
});
// test('ReconciliationReportPgModel.upsert() ' async (t) => {
// });