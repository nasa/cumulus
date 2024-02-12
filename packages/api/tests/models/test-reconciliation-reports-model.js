'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { fakeReconciliationReportFactory } = require('../../lib/testUtils');
const { ReconciliationReport } = require('../../models');

let reconciliationReportModel;
test.before(async () => {
  process.env.ReconciliationReportsTable = randomString();
  reconciliationReportModel = new ReconciliationReport();
  await reconciliationReportModel.createTable();
});

test.after.always(async () => {
  await reconciliationReportModel.deleteTable();
});

test('create() creates a valid ReconciliationReport record', async (t) => {
  const reportData = fakeReconciliationReportFactory();
  const record = await reconciliationReportModel.create(reportData);

  t.is(record.name, reportData.name);
  t.is(record.type, reportData.type);
  t.is(record.status, reportData.status);
  t.is(record.location, reportData.location);
  t.truthy(record.createdAt);
  t.truthy(record.updatedAt);
});
