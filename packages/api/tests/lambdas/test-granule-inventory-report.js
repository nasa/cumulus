'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');

const { s3 } = require('@cumulus/aws-client/services');
const { getObject, getObjectStreamContents } = require('@cumulus/aws-client/S3');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  GranulePgModel,
  GranulesExecutionsPgModel,
  migrationDir,
  destroyLocalTestDb,
  generateLocalTestDb,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
} = require('@cumulus/db');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  normalizeEvent,
} = require('../../lib/reconciliationReport/normalizeEvent');
const {
  createGranuleInventoryReport,
} = require('../../lambdas/reports/granule-inventory-report');

test.before(async (t) => {
  t.context.testDbName = `granule_inventory_${cryptoRandomString({ length: 10 })}`;
  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.collection = fakeCollectionRecordFactory();
  t.context.collectionId = constructCollectionId(
    t.context.collection.name,
    t.context.collection.version
  );
  const collectionResponse = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = collectionResponse[0].cumulus_id;
});

test.beforeEach(async (t) => {
  t.context.bucketsToCleanup = [];
  t.context.stackName = randomId('stack');
  t.context.systemBucket = randomId('bucket');
  process.env.system_bucket = t.context.systemBucket;
  await s3()
    .createBucket({ Bucket: t.context.systemBucket })
    .then(() => t.context.bucketsToCleanup.push(t.context.systemBucket));
});

test.afterEach.always(async (t) => {
  await Promise.all([
    t.context.bucketsToCleanup.map(recursivelyDeleteS3Bucket),
  ]);
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
  });
});

test.serial('Writes a file containing all granules to S3.', async (t) => {
  const testGranules = range(20).map(() => fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
  }));
  await t.context.granulePgModel.insert(
    t.context.knex,
    testGranules
  );

  const reportRecordName = randomId('recordName');
  const reportKey = `${t.context.stackName}/reconciliation-reports/${reportRecordName}.csv`;
  const systemBucket = t.context.systemBucket;
  const reportParams = {
    ...normalizeEvent({ reportType: 'Granule Inventory', stackName: 'TestStack' }),
    reportKey,
    systemBucket,
    knex: t.context.knex,
  };

  await createGranuleInventoryReport(reportParams);

  const reportOnS3 = await getObject(s3(), {
    Bucket: systemBucket,
    Key: reportKey,
  });

  const reportData = await getObjectStreamContents(reportOnS3.Body);

  const header = '"granuleUr","collectionId","createdAt","startDateTime","endDateTime","status","updatedAt","published"';
  t.true(reportData.includes(header));
  testGranules.forEach((g) => {
    const createdAt = new Date(g.created_at).toISOString();
    const searchStr = `"${g.granule_id}","${t.context.collectionId}","${createdAt}"`;
    t.true(reportData.includes(searchStr));
  });
});

test.serial('Writes a file containing a filtered set of granules to S3.', async (t) => {
  const {
    collectionId,
    collectionCumulusId,
    granulePgModel,
    knex,
  } = t.context;

  const status = 'running';
  const granuleId = randomString();

  const testGranules = [
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      status,
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      status,
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      status,
      granule_id: 'testGranule',
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      status,
      granule_id: 'testAnotherGranule',
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      status,
      granule_id: granuleId,
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      status: 'completed',
    }),
  ];
  await granulePgModel.insert(
    knex,
    testGranules
  );

  const reportRecordName = randomId('recordName');
  const reportKey = `${t.context.stackName}/reconciliation-reports/${reportRecordName}.csv`;
  const systemBucket = t.context.systemBucket;
  const reportParams = {
    ...normalizeEvent({
      reportType: 'Granule Inventory',
      collectionId,
      status,
      granuleId: 'test',
      stackName: 'testStack',
    }),
    reportKey,
    systemBucket,
    knex: t.context.knex,
  };

  await createGranuleInventoryReport(reportParams);

  const reportOnS3 = await getObject(s3(), {
    Bucket: systemBucket,
    Key: reportKey,
  });

  const reportData = await getObjectStreamContents(reportOnS3.Body);
  const reportArray = reportData.split('\n');
  const reportHeader = reportArray.slice(0, 1)[0];
  const reportRows = reportArray.slice(1, reportArray.length);

  const header = '"granuleUr","collectionId","createdAt","startDateTime","endDateTime","status","updatedAt","published","provider"';
  t.is(reportHeader, header);
  t.is(reportRows.length, 2);
});
