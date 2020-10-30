'use strict';

const test = require('ava');
const range = require('lodash/range');
const { s3 } = require('@cumulus/aws-client/services');
const { getObject } = require('@cumulus/aws-client/S3');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');
const {
  normalizeEvent,
} = require('../../lib/reconciliationReport/normalizeEvent');
const {
  createGranuleInventoryReport,
} = require('../../lambdas/reports/granule-inventory-report');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');

test.beforeEach(async (t) => {
  process.env.GranulesTable = randomId('granulesTable');
  await new models.Granule().createTable();
  t.context.bucketsToCleanup = [];
  t.context.stackName = randomId('stack');
  t.context.systemBucket = randomId('systembucket');
  process.env.system_bucket = t.context.systemBucket;
  await s3()
    .createBucket({ Bucket: t.context.systemBucket })
    .promise()
    .then(() => t.context.bucketsToCleanup.push(t.context.systemBucket));
});

test.afterEach.always(async (t) => {
  await Promise.all([
    t.context.bucketsToCleanup.map(recursivelyDeleteS3Bucket),
    new models.Granule().deleteTable(),
  ]);
});

test.serial('Writes a file containing all granules to S3.', async (t) => {
  const testGranules = range(20).map(() => fakeGranuleFactoryV2());
  await new models.Granule().create(testGranules);
  const reportRecordName = randomId('recordName');
  const reportKey = `${t.context.stackName}/reconciliation-reports/${reportRecordName}.csv`;
  const systemBucket = t.context.systemBucket;
  const reportParams = {
    ...normalizeEvent({ reportType: 'Granule Inventory' }),
    reportKey,
    systemBucket,
  };

  await createGranuleInventoryReport(reportParams);

  const reportOnS3 = await getObject(s3(), {
    Bucket: systemBucket,
    Key: reportKey,
  });

  const reportData = reportOnS3.Body.toString();

  const header = '"granuleUr","collectionId","createdAt","startDateTime","endDateTime","status","updatedAt","published"';
  t.true(reportData.includes(header));
  testGranules.forEach((g) => {
    const createdAt = new Date(g.createdAt).toISOString();
    const searchStr = `"${g.granuleId}","${g.collectionId}","${createdAt}"`;
    t.true(reportData.includes(searchStr));
  });
});

test.serial('Writes a file containing a filtered set of granules to S3.', async (t) => {
  const collectionId = randomString();
  const status = 'running';
  const granuleId = randomString();
  const testGranules = [
    fakeGranuleFactoryV2({ collectionId, status }),
    fakeGranuleFactoryV2({ collectionId, status }),
    fakeGranuleFactoryV2({ collectionId, status, granuleId: 'testGranule' }),
    fakeGranuleFactoryV2({ collectionId, status, granuleId: 'testAnotherGranule' }),
    fakeGranuleFactoryV2({ collectionId, status, granuleId }),
    fakeGranuleFactoryV2({ collectionId, status: 'completed' }),
  ];
  await new models.Granule().create(testGranules);
  const reportRecordName = randomId('recordName');
  const reportKey = `${t.context.stackName}/reconciliation-reports/${reportRecordName}.csv`;
  const systemBucket = t.context.systemBucket;
  const reportParams = {
    ...normalizeEvent({
      reportType: 'Granule Inventory',
      collectionId,
      status,
      granuleId: 'test',
    }),
    reportKey,
    systemBucket,
  };

  await createGranuleInventoryReport(reportParams);

  const reportOnS3 = await getObject(s3(), {
    Bucket: systemBucket,
    Key: reportKey,
  });

  const reportData = reportOnS3.Body.toString();
  const reportArray = reportData.split('\n');
  const reportHeader = reportArray.slice(0, 1)[0];
  const reportRows = reportArray.slice(1, reportArray.length);

  const header = '"granuleUr","collectionId","createdAt","startDateTime","endDateTime","status","updatedAt","published"';
  t.is(reportHeader, header);
  t.is(reportRows.length, 2);
});
