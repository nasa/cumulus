'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const models = require('../models');
const { Search } = require('../es/search');
const bootstrap = require('../lambdas/bootstrap');
const dbIndexer = require('../lambdas/db-indexer');
const { constructCollectionId } = require('../lib/utils');
const {
  fakeCollectionFactory,
  fakeGranuleFactory,
  fakeExecutionFactory
} = require('../lib/testUtils');

let esClient;
const seq = new Set(); // to keep track of processed records in the stream
const esIndex = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();
process.env.CollectionsTable = `${process.env.stackName}-CollectionsTable`;
process.env.GranulesTable = `${process.env.stackName}-GranulesTable`;
process.env.ExecutionsTable = `${process.env.stackName}-ExecutionsTable`;


function addSourceArn(tableName, records) {
  const sourceArn = 'arn:aws:dynamodb:us-east-1:000:table/' +
    `${tableName}/stream/2018-05-03T16:24:17.527`;

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
  const lastSequence = parseInt(Array.from(sequence).pop());
  if (lastSequence) {
    records.Records = [];

    allRecords.forEach((r) => {
      if (parseInt(r.dynamodb.SequenceNumber) > lastSequence) {
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

test.before(async () => {
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();

  // create collections table
  const hash = { name: 'name', type: 'S' };
  const range = { name: 'version', type: 'S' };
  await models.Manager.createTable(process.env.CollectionsTable, hash, range);
  await models.Manager.createTable(process.env.GranulesTable, { name: 'granuleId', type: 'S' });
  await models.Manager.createTable(process.env.ExecutionsTable, { name: 'arn', type: 'S' });

  // bootstrap the esIndex
  esClient = await Search.es();
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);
});

test.after.always(async () => {
  await models.Manager.deleteTable(process.env.CollectionsTable);
  await models.Manager.deleteTable(process.env.GranulesTable);
  await models.Manager.deleteTable(process.env.ExecutionsTable);
  await aws.recursivelyDeleteS3Bucket(process.env.internal);
  await esClient.indices.delete({ index: esIndex });
});

test.serial('create, update and delete a collection in dynamodb and es', async (t) => {
  const c = fakeCollectionFactory();
  const collections = new models.Collection();
  await collections.create(c);

  // get records from the stream
  let records = await getDyanmoDBStreamRecords(process.env.CollectionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, () => {});

  const collectionIndex = new Search({}, 'collection');
  let indexedRecord = await collectionIndex.get(constructCollectionId(c.name, c.version));

  t.is(indexedRecord.name, c.name);

  // change the record
  c.dataType = 'testing';
  await collections.create(c);

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.CollectionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, () => {});

  indexedRecord = await collectionIndex.get(constructCollectionId(c.name, c.version));
  t.is(indexedRecord.dataType, 'testing');

  // delete the record
  await collections.delete({ name: c.name, version: c.version });

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.CollectionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, () => {});

  const response = await collectionIndex.get(constructCollectionId(c.name, c.version));
  t.is(response.detail, 'Record not found');
});

test.serial('create, update and delete a granule in dynamodb and es', async (t) => {
  const fakeGranule = fakeGranuleFactory();
  const model = new models.Granule();
  await model.create(fakeGranule);

  // get records from the stream
  let records = await getDyanmoDBStreamRecords(process.env.GranulesTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, () => {});

  const granuleIndex = new Search({}, 'granule');
  let indexedRecord = await granuleIndex.get(fakeGranule.granuleId);

  t.is(indexedRecord.granuleId, fakeGranule.granuleId);

  // change the record
  fakeGranule.status = 'failed';
  await model.create(fakeGranule);

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.GranulesTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, () => {});

  indexedRecord = await granuleIndex.get(fakeGranule.granuleId);
  t.is(indexedRecord.status, 'failed');

  // delete the record
  await model.delete({ granuleId: fakeGranule.granuleId });

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.GranulesTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, () => {});

  indexedRecord = await granuleIndex.get(fakeGranule.granuleId);
  t.is(indexedRecord.detail, 'Record not found');
});

test.serial('create, update and delete an execution in dynamodb and es', async (t) => {
  const fakeRecord = fakeExecutionFactory();
  const model = new models.Execution();
  await model.create(fakeRecord);

  // get records from the stream
  let records = await getDyanmoDBStreamRecords(process.env.ExecutionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, () => {});

  const recordIndex = new Search({}, 'execution');
  let indexedRecord = await recordIndex.get(fakeRecord.arn);

  t.is(indexedRecord.arn, fakeRecord.arn);

  // change the record
  fakeRecord.status = 'failed';
  await model.create(fakeRecord);

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.ExecutionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, () => {});

  indexedRecord = await recordIndex.get(fakeRecord.arn);
  t.is(indexedRecord.status, 'failed');

  // delete the record
  await model.delete({ arn: fakeRecord.arn });

  // get records from the stream
  records = await getDyanmoDBStreamRecords(process.env.ExecutionsTable);

  // fake the lambda trigger
  await dbIndexer(records, {}, () => {});

  indexedRecord = await recordIndex.get(fakeRecord.arn);
  t.is(indexedRecord.detail, 'Record not found');
});
