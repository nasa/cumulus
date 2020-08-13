'use strict';

const moment = require('moment');
const { s3 } = require('@cumulus/aws-client/services');
const { buildS3Uri, recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { run } = require('../../migrations/migration_5');
const models = require('../../models');

process.env.ReconciliationReportsTable = `ReconciliationReportsTable${randomString()}`;
process.env.stackName = 'my-stackName';
process.env.system_bucket = randomString();

const reportFileKey = `${process.env.stackName}/reconciliation-reports/my-reconciliationReport.json`;
const reconciliationReport = {
  reportStartTime: moment.utc().subtract(5, 'minutes'),
  reportEndTime: moment.utc().format(),
  status: 'SUCCESS',
  error: null,
  filesInCumulus: {
    okCount: 88,
  },
  collectionsInCumulusCmr: {
    okCount: 1,
  },
};

let reconciliationReportModel;
test.before(async () => {
  reconciliationReportModel = new models.ReconciliationReport();
  await reconciliationReportModel.createTable();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: reportFileKey,
    Body: JSON.stringify(reconciliationReport),
  }).promise();
});

test.after.always(async () => {
  await reconciliationReportModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('migration_5 adds record to database when the record does not already exist', async (t) => {
  await run();
  let items = await reconciliationReportModel.scan();
  t.is(items.Items.length, 1);
  const item = items.Items[0];
  t.is(item.createdAt, moment.utc(reconciliationReport.reportStartTime).toDate().getTime());
  t.is(item.status, 'Generated');
  t.is(item.type, 'Inventory');
  t.is(item.location, buildS3Uri(process.env.system_bucket, reportFileKey));

  await run();
  items = await reconciliationReportModel.scan();
  t.is(items.Items.length, 1);
});
