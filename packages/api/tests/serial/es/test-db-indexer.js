'use strict';

const test = require('ava');
const drop = require('lodash.drop');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const {
  constructCollectionId,
  util: { noop }
} = require('@cumulus/common');

const models = require('../../../models');
const { Search } = require('../../../es/search');
const bootstrap = require('../../../lambdas/bootstrap');
const dbIndexer = require('../../../lambdas/db-indexer');
const {
  fakeCollectionFactory,
  fakeGranuleFactory,
  fakeExecutionFactory,
  fakeFilesFactory,
  deleteAliases
} = require('../../../lib/testUtils');

let esClient;
const seq = new Set(); // to keep track of processed records in the stream
const esIndex = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.CollectionsTable = `${process.env.stackName}-CollectionsTable`;
process.env.GranulesTable = `${process.env.stackName}-GranulesTable`;
process.env.FilesTable = `${process.env.stackName}-FilesTable`;
process.env.ExecutionsTable = `${process.env.stackName}-ExecutionsTable`;
process.env.RulesTable = randomString();

function addSourceArn(tableName, records) {
  const sourceArn = 'arn:aws:dynamodb:us-east-1:000:table/'
    + `${tableName}/stream/2018-05-03T16:24:17.527`;

  // add eventSourceArn
  records.Records.forEach((record) => {
    record.eventSourceARN = sourceArn;
  });
  return records;
}

function updateSequenceNumber(records, sequence) {
  records.Records.forEach((r) => {
    sequence.add(r.dynamodb.SequenceNumber);
  });
}

function removeProcessedRecords(records, sequence) {
  const allRecords = records.Records;
  const lastSequence = parseInt(Array.from(sequence).pop(), 10);
  if (lastSequence) {
    records.Records = [];

    allRecords.forEach((r) => {
      if (parseInt(r.dynamodb.SequenceNumber, 10) > lastSequence) {
        records.Records.push(r);
      }
    });
  }
}

async function getDyanmoDBStreamRecords(table) {
  const streams = await aws.dynamodbstreams()
    .listStreams({ TableName: table })
    .promise();

  const activeStream = streams.Streams
    .filter((s) => (s.TableName === table))[0];

  const streamDetails = await aws.dynamodbstreams().describeStream({
    StreamArn: activeStream.StreamArn
  }).promise();
  const shard = streamDetails.StreamDescription.Shards[0];
  const params = {
    ShardId: shard.ShardId,
    ShardIteratorType: 'TRIM_HORIZON',
    StreamArn: activeStream.StreamArn
  };

  const iterator = await aws.dynamodbstreams().getShardIterator(params).promise();
  const records = await aws.dynamodbstreams().getRecords({
    ShardIterator: iterator.ShardIterator
  }).promise();

  // remove records that are processed
  removeProcessedRecords(records, seq);

  // get the latest sequence number
  updateSequenceNumber(records, seq);

  addSourceArn(table, records);
  return records;
}

let collectionModel;
let executionModel;
let fileModel;
let granuleModel;
let ruleModel;
test.before(async () => {
  await deleteAliases();
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  // create tables
  collectionModel = new models.Collection();
  granuleModel = new models.Granule();
  fileModel = new models.FileClass();
  executionModel = new models.Execution();
  ruleModel = new models.Rule();

  await Promise.all([
    collectionModel.createTable(),
    executionModel.createTable(),
    fileModel.createTable(),
    granuleModel.createTable(),
    ruleModel.createTable()
  ]);

  await Promise.all([
    collectionModel.enableStream(),
    executionModel.enableStream(),
    granuleModel.enableStream()
  ]);

  // bootstrap the esIndex
  esClient = await Search.es();
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);
  process.env.esIndex = esIndex;
});

test.after.always(async () => {
  await collectionModel.deleteTable();
  await granuleModel.deleteTable();
  await executionModel.deleteTable();
  await fileModel.deleteTable();
  await ruleModel.deleteTable();

  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
});

test.serial('create, update and delete a collection in dynamodb and es', async (t) => {
  const c = fakeCollectionFactory();
  const collections = new models.Collection();
  await collections.create(c);
  

  // get records from the stream
  let records = await getDyanmoDBStreamRecords(process.env.CollectionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, noop);

  const collectionIndex = new Search({}, 'collection');
  let indexedRecord = await collectionIndex.get(constructCollectionId(c.name, c.version));

  t.is(indexedRecord.name, c.name);

  // change the record
  c.dataType = 'testing';
  await collections.create(c);

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.CollectionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, noop);

  indexedRecord = await collectionIndex.get(constructCollectionId(c.name, c.version));
  t.is(indexedRecord.dataType, 'testing');

  // delete the record
  await collections.delete({ name: c.name, version: c.version });

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.CollectionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, noop);

  const response = await collectionIndex.get(constructCollectionId(c.name, c.version));
  t.is(response.detail, 'Record not found');
});

test.serial('create, update and delete a granule in dynamodb and es', async (t) => {
  const fakeGranule = fakeGranuleFactory();
  fakeGranule.files = [];
  const bucket = randomString();
  for (let i = 0; i < 4; i += 1) {
    fakeGranule.files.push(fakeFilesFactory(bucket));
  }

  await granuleModel.create(fakeGranule);

  // get records from the stream
  let records = await getDyanmoDBStreamRecords(process.env.GranulesTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, noop);

  const granuleIndex = new Search({}, 'granule');
  let indexedRecord = await granuleIndex.get(fakeGranule.granuleId);

  t.is(indexedRecord.granuleId, fakeGranule.granuleId);

  // make sure all the file records are added
  await Promise.all(fakeGranule.files.map(async (file) => {
    const record = await fileModel.get({ bucket, key: file.key });
    t.is(record.bucket, file.bucket);
    t.is(record.key, file.key);
    t.is(record.granuleId, fakeGranule.granuleId);
  }));

  // change the record
  fakeGranule.status = 'failed';
  fakeGranule.files = drop(fakeGranule.files);
  await granuleModel.create(fakeGranule);

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.GranulesTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, noop);

  indexedRecord = await granuleIndex.get(fakeGranule.granuleId);
  t.is(indexedRecord.status, 'failed');

  // delete the record
  await granuleModel.delete({ granuleId: fakeGranule.granuleId });

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.GranulesTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, noop);

  indexedRecord = await granuleIndex.get(fakeGranule.granuleId);
  t.is(indexedRecord.detail, 'Record not found');

  // make sure the file records are deleted
  await Promise.all(fakeGranule.files.map(async (file) => {
    const p = fileModel.get({ bucket, key: file.key });
    const e = await t.throws(p);
    t.true(e.message.includes('No record'));
  }));

  const deletedGranIndex = new Search({}, 'deletedgranule');
  const deletedGranRecord = await deletedGranIndex.get(fakeGranule.granuleId);
  t.is(deletedGranRecord.granuleId, fakeGranule.granuleId);
});

test.serial('create, update and delete an execution in dynamodb and es', async (t) => {
  const fakeRecord = fakeExecutionFactory();
  const model = new models.Execution();
  await model.create(fakeRecord);

  // get records from the stream
  let records = await getDyanmoDBStreamRecords(process.env.ExecutionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, noop);

  const recordIndex = new Search({}, 'execution');
  let indexedRecord = await recordIndex.get(fakeRecord.arn);

  t.is(indexedRecord.arn, fakeRecord.arn);

  // change the record
  fakeRecord.status = 'failed';
  await model.create(fakeRecord);

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.ExecutionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, noop);

  indexedRecord = await recordIndex.get(fakeRecord.arn);
  t.is(indexedRecord.status, 'failed');

  // delete the record
  await model.delete({ arn: fakeRecord.arn });

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.ExecutionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, noop);

  indexedRecord = await recordIndex.get(fakeRecord.arn);
  t.is(indexedRecord.detail, 'Record not found');
});
