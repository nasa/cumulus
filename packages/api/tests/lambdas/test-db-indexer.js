'use strict';

const test = require('ava');
const rewire = require('rewire');
const attr = require('dynamodb-data-types').AttributeValue;
const awsServices = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const { Search } = require('@cumulus/es-client/search');

const models = require('../../models');
const dbIndexer = rewire('../../lambdas/db-indexer');
const {
  fakeReconciliationReportFactory,
} = require('../../lib/testUtils');

const {
  getTableName,
  getTableIndexDetails,
  handler,
  getRecordId,
  performDelete,
  performIndex,
} = dbIndexer;

let esClient;
const esIndex = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.ReconciliationReportsTable = randomString();

const buildDynamoStreamRecord = ({
  eventName, tableName, keys, oldImage, newImage,
}) => {
  const record = {
    eventID: '1',
    eventName,
    eventVersion: '1.0',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    eventSourceARN: `arn:aws:dynamodb:us-east-1:account-id:table/${tableName}/stream/2015-06-27T00:48:05.899`,
    dynamodb: {
      Keys: attr.wrap(keys),
      SequenceNumber: '1',
      SizeBytes: eventName === 'REMOVE' ? -1 : 1,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };

  if (['INSERT', 'MODIFY'].includes(eventName)) {
    record.dynamodb.NewImage = attr.wrap(newImage);
  }

  if (['MODIFY', 'REMOVE'].includes(eventName)) {
    record.dynamodb.OldImage = attr.wrap(oldImage);
  }

  return record;
};

const buildReconciliationReportRecord = ({ type, oldReport, newReport }) => {
  const name = type === 'REMOVE' ? oldReport.name : newReport.name;

  return buildDynamoStreamRecord({
    eventName: type,
    tableName: process.env.ReconciliationReportsTable,
    keys: { name },
    oldImage: oldReport,
    newImage: newReport,
  });
};

let reconciliationReportModel;

test.before(async (t) => {
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });

  // create table
  reconciliationReportModel = new models.ReconciliationReport();

  await Promise.all([
    reconciliationReportModel.createTable(),
  ]);

  // bootstrap the esIndex
  esClient = await Search.es();

  t.context.esAlias = randomString();
  process.env.ES_INDEX = t.context.esAlias;

  await bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: t.context.esAlias,
  });
});

test.after.always(async () => {
  await reconciliationReportModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
});

test('getRecordId() returns correct ID for record', (t) => {
  const reconciliationReport = {
    name: randomString(),
  };
  t.is(
    getRecordId('reconciliationReport', reconciliationReport),
    reconciliationReport.name
  );
});

test('getTableName() returns undefined for invalid input', (t) => {
  t.is(
    getTableName('bad-input'),
    undefined
  );
});

test('getTableName() returns the full name of the DynamoDB table associated with the incoming record', (t) => {
  const tableName = randomString();
  const eventSourceARN = `arn:aws:dynamodb:us-east-1:account-id:table/${tableName}/stream/2015-06-27T00:48:05.899`;
  t.is(getTableName(eventSourceARN), tableName);
});

test('getTableIndexDetails() returns undefined for unsupported table', (t) => {
  t.is(getTableIndexDetails('fake-table-name'), undefined);
});

test('getTableIndexDetails() returns a correct function name and index type', (t) => {
  t.deepEqual(getTableIndexDetails(process.env.ReconciliationReportsTable), {
    indexFnName: 'indexReconciliationReport',
    deleteFnName: 'deleteReconciliationReport',
    indexType: 'reconciliationReport',
  });
});

test('performIndex() indexes a record to ES', async (t) => {
  const { esAlias } = t.context;
  const reconIndex = new Search({}, 'reconciliationReport', esAlias);
  const reconReport = fakeReconciliationReportFactory();
  await performIndex('indexReconciliationReport', esClient, reconReport);
  const indexedRecord = await reconIndex.get(reconReport.name);
  // delete dynamically generated values for comparisons
  delete indexedRecord._id;
  delete indexedRecord.timestamp;
  t.deepEqual(indexedRecord, reconReport);
});

test('performDelete() deletes a record from ES', async (t) => {
  const { esAlias } = t.context;
  const reconIndex = new Search({}, 'reconciliationReport', esAlias);
  const reconReport = fakeReconciliationReportFactory();

  await performIndex('indexReconciliationReport', esClient, reconReport);
  const indexedRecord = await reconIndex.get(reconReport.name);
  t.is(indexedRecord.name, reconReport.name);

  await performDelete('deleteReconciliationReport', esClient, 'reconciliationReport', reconReport.name);
  const deletedRecord = await reconIndex.get(reconReport.name);
  t.is(deletedRecord.detail, 'Record not found');
});

test.serial('Create, Update, and Delete reconciliation report succeeds in DynamoDB and Elasticsearch', async (t) => {
  const { esAlias } = t.context;

  const fakeReport = fakeReconciliationReportFactory();

  const insertRecord = buildReconciliationReportRecord({
    type: 'INSERT',
    newReport: fakeReport,
  });

  // Fake the lambda trigger
  await handler({ Records: [insertRecord] });

  const recordIndex = new Search({}, 'reconciliationReport', esAlias);
  let indexedRecord = await recordIndex.get(fakeReport.name);

  console.log(indexedRecord);
  t.is(indexedRecord.name, fakeReport.name);

  // Modify the record
  const modifyRecord = buildReconciliationReportRecord({
    type: 'MODIFY',
    oldReport: fakeReport,
    newReport: { ...fakeReport, status: 'failed' },
  });

  // Fake the lambda trigger
  await handler({ Records: [modifyRecord] });

  indexedRecord = await recordIndex.get(fakeReport.name);
  t.is(indexedRecord.status, 'failed');

  // Delete the record
  const removeRecord = buildReconciliationReportRecord({
    type: 'REMOVE',
    oldReport: { ...fakeReport, status: 'failed' },
  });

  // fake the lambda trigger
  await handler({ Records: [removeRecord] });

  indexedRecord = await recordIndex.get(fakeReport.name);
  t.is(indexedRecord.detail, 'Record not found');
});
