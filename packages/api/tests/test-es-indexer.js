'use strict';

const test = require('ava');
const sinon = require('sinon');
const fs = require('fs');
const clone = require('lodash.clonedeep');
const path = require('path');
const aws = require('@cumulus/common/aws');
const { StepFunction } = require('@cumulus/ingest/aws');
const { randomString } = require('@cumulus/common/test-utils');
const indexer = require('../es/indexer');
const { Search } = require('../es/search');
const { bootstrapElasticSearch } = require('../lambdas/bootstrap');
const granuleSuccess = require('./data/granule_success.json');
const granuleFailure = require('./data/granule_failed.json');
const pdrFailure = require('./data/pdr_failure.json');
const pdrSuccess = require('./data/pdr_success.json');
const cmrjs = require('@cumulus/cmrjs');

const esIndex = randomString();
process.env.bucket = randomString();
process.env.stackName = randomString();
process.env.ES_INDEX = esIndex;
let esClient;

test.before(async () => {
  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch('fakehost', esIndex);
  esClient = await Search.es();

  // create buckets
  await aws.s3().createBucket({ Bucket: process.env.bucket }).promise();

  const fakeMetadata = {
    time_start: '2017-10-24T00:00:00.000Z',
    time_end: '2018-10-24T00:00:00.000Z',
    updated: '2018-04-25T21:45:45.524Z',
    dataset_id: 'MODIS/Terra Surface Reflectance Daily L2G Global 250m SIN Grid V006',
    data_center: 'CUMULUS',
    title: 'MOD09GQ.A2016358.h13v04.006.2016360104606'
  };

  sinon.stub(cmrjs, 'getMetadata').callsFake(() => fakeMetadata);
});

test.after.always(async () => {
  Promise.all([
    esClient.indices.delete({ index: esIndex }),
    aws.recursivelyDeleteS3Bucket(process.env.bucket)
  ]);

  cmrjs.getMetadata.restore();
});

test.serial('indexing a successful granule record', async (t) => {
  const type = 'granule';
  const granule = granuleSuccess.payload.granules[0];
  const collection = granuleSuccess.meta.collection;
  const r = await indexer.granule(esClient, granuleSuccess, esIndex, type);

  // make sure record is created
  t.is(r[0].result, 'created');

  const collectionId = indexer.constructCollectionId(collection.name, collection.version);

  // check the record exists
  const record = await esClient.get({
    index: esIndex,
    type,
    id: granule.granuleId,
    parent: collectionId
  });

  console.log(`\n\n${JSON.stringify(record)}\n\n`);

  t.deepEqual(record._source.files, granule.files);
  t.is(record._source.status, 'completed');
  t.is(record._parent, collectionId);
  t.is(record._id, granule.granuleId);
  t.is(record._source.cmrLink, granule.cmrLink);
  t.is(record._source.published, granule.published);
  t.is(record._source.productVolume, 17909733);
  t.is(record._source.beginningDateTime, '2017-10-24T00:00:00.000Z');
  t.is(record._source.endingDateTime, '2018-10-24T00:00:00.000Z');
  t.is(record._source.timeToArchive, 120);
  t.is(record._source.productionDateTime, 1525357393007);

  const { name: deconstructed } = indexer.deconstructCollectionId(record._parent);
  t.is(deconstructed, collection.name);
});

test.serial('indexing multiple successful granule records', async (t) => {
  const newPayload = clone(granuleSuccess);
  const type = 'granule';
  const granule = newPayload.payload.granules[0];
  granule.granuleId = randomString();
  const granule2 = clone(granule);
  granule2.granuleId = randomString();
  newPayload.payload.granules.push(granule2);
  const collection = newPayload.meta.collection;
  const response = await indexer.granule(esClient, newPayload, esIndex, type);

  const collectionId = indexer.constructCollectionId(collection.name, collection.version);

  t.is(response.length, 2);
  const promises = response.map((r) => {
    t.is(r.result, 'created');

    // check the record exists
    return esClient.get({
      index: esIndex,
      type,
      id: r._id,
      parent: collectionId
    });
  });

  const records = await Promise.all(promises);
  records.forEach((record) => {
    t.is(record._source.status, 'completed');
    t.is(record._parent, collectionId);
    t.is(record._source.cmrLink, granule.cmrLink);
    t.is(record._source.published, granule.published);
  });
});

test.serial('indexing a failed granule record', async (t) => {
  const type = 'granule';
  const granule = granuleFailure.payload.granules[0];
  const collection = granuleFailure.meta.collection;
  const r = await indexer.granule(esClient, granuleFailure, esIndex, type);

  // make sure record is created
  t.is(r[0].result, 'created');

  const collectionId = indexer.constructCollectionId(collection.name, collection.version);

  // check the record exists
  const record = await esClient.get({
    index: esIndex,
    type,
    id: granule.granuleId,
    parent: collectionId
  });

  t.deepEqual(record._source.files, granule.files);
  t.is(record._source.status, 'failed');
  t.is(record._id, granule.granuleId);
  t.is(record._source.published, false);
  t.is(record._source.error.Error, granuleFailure.exception.Error);
  t.is(record._source.error.Cause, granuleFailure.exception.Cause);
});

test.serial('indexing a granule record without state_machine info', async (t) => {
  const newPayload = clone(granuleSuccess);
  const type = 'granule';
  delete newPayload.cumulus_meta.state_machine;

  const r = await indexer.granule(esClient, newPayload, esIndex, type);
  t.is(r, undefined);
});

test.serial('indexing a granule record without a granule', async (t) => {
  const newPayload = clone(granuleSuccess);
  const type = 'granule';
  delete newPayload.payload;
  delete newPayload.meta;

  const r = await indexer.granule(esClient, newPayload, esIndex, type);
  t.is(r, undefined);
});

test.serial('indexing a granule record in meta section', async (t) => {
  const newPayload = clone(granuleSuccess);
  const type = 'granule';
  delete newPayload.payload;
  newPayload.meta.status = 'running';
  const collection = newPayload.meta.collection;
  const granule = newPayload.meta.input_granules[0];
  granule.granuleId = randomString();

  const r = await indexer.granule(esClient, newPayload, esIndex, type);

  // make sure record is created
  t.is(r[0].result, 'created');

  const collectionId = indexer.constructCollectionId(collection.name, collection.version);

  // check the record exists
  const record = await esClient.get({
    index: esIndex,
    type,
    id: granule.granuleId,
    parent: collectionId
  });

  t.deepEqual(record._source.files, granule.files);
  t.is(record._source.status, 'running');
  t.is(record._parent, collectionId);
  t.is(record._id, granule.granuleId);
  t.is(record._source.published, false);
});

test.serial('indexing a rule record', async (t) => {
  const testRecord = {
    name: randomString()
  };

  const r = await indexer.indexRule(esClient, testRecord, esIndex);

  // make sure record is created
  t.is(r.result, 'created');

  // check the record exists
  const record = await esClient.get({
    index: esIndex,
    type: 'rule',
    id: testRecord.name
  });

  t.is(record._id, testRecord.name);
  t.is(typeof record._source.timestamp, 'number');
});

test.serial('indexing a provider record', async (t) => {
  const testRecord = {
    id: randomString()
  };

  const r = await indexer.indexProvider(esClient, testRecord, esIndex);

  // make sure record is created
  t.is(r.result, 'created');

  // check the record exists
  const record = await esClient.get({
    index: esIndex,
    type: 'provider',
    id: testRecord.id
  });

  t.is(record._id, testRecord.id);
  t.is(typeof record._source.timestamp, 'number');
});

test.serial('indexing a collection record', async (t) => {
  const collection = {
    name: randomString(),
    version: '001'
  };

  const collectionId = indexer.constructCollectionId(collection.name, collection.version);
  const r = await indexer.indexCollection(esClient, collection, esIndex);

  // make sure record is created
  t.is(r.result, 'created');

  // check the record exists
  const record = await esClient.get({
    index: esIndex,
    type: 'collection',
    id: collectionId
  });

  t.is(record._id, collectionId);
  t.is(record._source.name, collection.name);
  t.is(record._source.version, collection.version);
  t.is(typeof record._source.timestamp, 'number');
});

test.serial('indexing a failed pdr record', async (t) => {
  const type = 'pdr';
  const payload = pdrFailure.payload;
  payload.pdr.name = randomString();
  const collection = pdrFailure.meta.collection;
  const r = await indexer.pdr(esClient, pdrFailure, esIndex, type);

  // make sure record is created
  t.is(r.result, 'created');

  const collectionId = indexer.constructCollectionId(collection.name, collection.version);

  // check the record exists
  const response = await esClient.get({
    index: esIndex,
    type,
    id: payload.pdr.name
  });
  const record = response._source;

  t.is(record.status, 'failed');
  t.is(record.collectionId, collectionId);
  t.is(response._id, payload.pdr.name);
  t.is(record.pdrName, payload.pdr.name);

  // check stats
  const stats = record.stats;
  t.is(stats.total, 1);
  t.is(stats.failed, 1);
  t.is(stats.processing, 0);
  t.is(stats.completed, 0);
  t.is(record.progress, 100);
});

test.serial('indexing a successful pdr record', async (t) => {
  const type = 'pdr';
  pdrSuccess.meta.pdr.name = randomString();
  const pdr = pdrSuccess.meta.pdr;
  const collection = pdrSuccess.meta.collection;
  const r = await indexer.pdr(esClient, pdrSuccess, esIndex, type);

  // make sure record is created
  t.is(r.result, 'created');

  const collectionId = indexer.constructCollectionId(collection.name, collection.version);

  // check the record exists
  const response = await esClient.get({
    index: esIndex,
    type,
    id: pdr.name
  });
  const record = response._source;

  t.is(record.status, 'completed');
  t.is(record.collectionId, collectionId);
  t.is(response._id, pdr.name);
  t.is(record.pdrName, pdr.name);

  // check stats
  const stats = record.stats;
  t.is(stats.total, 3);
  t.is(stats.failed, 1);
  t.is(stats.processing, 0);
  t.is(stats.completed, 2);
  t.is(record.progress, 100);
});

test.serial('indexing a running pdr record', async (t) => {
  const type = 'pdr';
  const newPayload = clone(pdrSuccess);
  newPayload.meta.pdr.name = randomString();
  newPayload.meta.status = 'running';
  newPayload.payload.running.push('arn');
  const pdr = newPayload.meta.pdr;
  const r = await indexer.pdr(esClient, newPayload, esIndex, type);

  // make sure record is created
  t.is(r.result, 'created');

  // check the record exists
  const response = await esClient.get({
    index: esIndex,
    type,
    id: pdr.name
  });
  const record = response._source;

  t.is(record.status, 'running');

  // check stats
  const stats = record.stats;
  t.is(stats.total, 4);
  t.is(stats.failed, 1);
  t.is(stats.processing, 1);
  t.is(stats.completed, 2);
  t.is(record.progress, 75);
});

test.serial('indexing a running pdr when pdr is missing', async (t) => {
  const type = 'pdr';
  delete pdrSuccess.meta.pdr;
  const r = await indexer.pdr(esClient, pdrSuccess, esIndex, type);

  // make sure record is created
  t.is(r, undefined);
});

test.serial('indexing a step function with missing arn', async (t) => {
  const newPayload = clone(granuleSuccess);
  delete newPayload.cumulus_meta.state_machine;

  const promise = indexer.indexStepFunction(esClient, newPayload, esIndex);
  const error = await t.throws(promise);
  t.is(error.message, 'State Machine Arn is missing. Must be included in the cumulus_meta');
});

test.serial('indexing a successful step function', async (t) => {
  const newPayload = clone(pdrSuccess);
  newPayload.cumulus_meta.execution_name = randomString();

  const r = await indexer.indexStepFunction(esClient, newPayload, esIndex);

  // make sure record is created
  t.is(r.result, 'created');

  // check the record exists
  const response = await esClient.get({
    index: esIndex,
    type: 'execution',
    id: r._id
  });
  const record = response._source;

  t.is(record.status, 'completed');
  t.is(record.type, newPayload.meta.workflow_name);
  t.is(record.createdAt, newPayload.cumulus_meta.workflow_start_time);
});

test.serial('indexing a failed step function', async (t) => {
  const newPayload = clone(pdrFailure);
  newPayload.cumulus_meta.execution_name = randomString();

  const r = await indexer.indexStepFunction(esClient, newPayload, esIndex);

  // make sure record is created
  t.is(r.result, 'created');

  // check the record exists
  const response = await esClient.get({
    index: esIndex,
    type: 'execution',
    id: r._id
  });
  const record = response._source;

  t.is(record.status, 'failed');
  t.is(record.type, newPayload.meta.workflow_name);
  t.is(typeof record.error, 'object');
  t.is(record.createdAt, newPayload.cumulus_meta.workflow_start_time);
});

test.serial('partially updating a provider record', async (t) => {
  const testRecord = {
    id: randomString()
  };
  const type = 'provider';

  let r = await indexer.indexProvider(esClient, testRecord, esIndex, type);

  // make sure record is created
  t.is(r.result, 'created');
  t.is(r._id, testRecord.id);

  // now partially update it
  const updatedRecord = {
    host: 'example.com'
  };
  r = await indexer.partialRecordUpdate(
    esClient,
    testRecord.id,
    type,
    updatedRecord,
    undefined,
    esIndex
  );

  t.is(r.result, 'updated');
  // check the record exists
  const record = await esClient.get({
    index: esIndex,
    type,
    id: testRecord.id
  });

  t.is(record._id, testRecord.id);
  t.is(record._source.host, updatedRecord.host);
});

test.serial('delete a provider record', async (t) => {
  const testRecord = {
    id: randomString()
  };
  const type = 'provider';

  let r = await indexer.indexProvider(esClient, testRecord, esIndex, type);

  // make sure record is created
  t.is(r.result, 'created');
  t.is(r._id, testRecord.id);

  r = await indexer.deleteRecord(
    esClient,
    testRecord.id,
    type,
    undefined,
    esIndex
  );

  t.is(r.result, 'deleted');

  // check the record exists
  const promise = esClient.get({
    index: esIndex,
    type,
    id: testRecord.id
  });
  const error = await t.throws(promise);
  t.is(error.message, 'Not Found');
});

test.serial('reingest a granule', async (t) => {
  const input = JSON.stringify(granuleSuccess);
  const fakeSFResponse = {
    execution: {
      input
    }
  };

  const payload = JSON.parse(input);
  const key = `${process.env.stackName}/workflows/${payload.meta.workflow_name}.json`;
  await aws.s3().putObject({ Bucket: process.env.bucket, Key: key, Body: 'test data' }).promise();

  payload.payload.granules[0].granuleId = randomString();
  const r = await indexer.granule(esClient, payload);

  sinon.stub(
    StepFunction,
    'getExecutionStatus'
  ).callsFake(() => Promise.resolve(fakeSFResponse));

  const collectionId = indexer.constructCollectionId(
    granuleSuccess.meta.collection.name,
    granuleSuccess.meta.collection.version
  );

  // check the record exists
  let record = await esClient.get({
    index: esIndex,
    type: 'granule',
    id: r[0]._id,
    parent: collectionId
  });

  t.is(record._source.status, 'completed');

  const response = await indexer.reingest(record._source, esIndex);
  t.is(response.action, 'reingest');
  t.is(response.status, 'SUCCESS');

  record = await esClient.get({
    index: esIndex,
    type: 'granule',
    id: r[0]._id,
    parent: collectionId
  });
  t.is(record._source.status, 'running');
});

test.serial('pass a sns message to main handler', async (t) => {
  const txt = fs.readFileSync(path.join(
    __dirname, '/data/sns_message_granule.txt'
  ), 'utf8');

  const event = JSON.parse(JSON.parse(txt.toString()));
  const resp = await indexer.handler(event, {}, () => {});

  t.is(resp.length, 1);
  t.truthy(resp[0].sf);
  t.truthy(resp[0].granule);
  t.falsy(resp[0].pdr);

  const msg = JSON.parse(event.Records[0].Sns.Message);
  const granule = msg.payload.granules[0];
  const collection = msg.meta.collection;
  const collectionId = indexer.constructCollectionId(collection.name, collection.version);
  // test granule record is added
  const record = await esClient.get({
    index: esIndex,
    type: 'granule',
    id: granule.granuleId,
    parent: collectionId
  });
  t.is(record._id, granule.granuleId);
});

test.serial('pass a sns message to main handler with parse info', async (t) => {
  const txt = fs.readFileSync(path.join(
    __dirname, '/data/sns_message_parse_pdr.txt'
  ), 'utf8');

  const event = JSON.parse(JSON.parse(txt.toString()));
  const resp = await indexer.handler(event, {}, () => {});

  t.is(resp.length, 1);
  t.truthy(resp[0].sf);
  t.falsy(resp[0].granule);
  t.truthy(resp[0].pdr);

  const msg = JSON.parse(event.Records[0].Sns.Message);
  const pdr = msg.payload.pdr;
  // test granule record is added
  const record = await esClient.get({
    index: esIndex,
    type: 'pdr',
    id: pdr.name
  });
  t.is(record._id, pdr.name);
  t.falsy(record._source.error);
});

test.serial('pass a sns message to main handler with discoverpdr info', async (t) => {
  const txt = fs.readFileSync(path.join(
    __dirname, '/data/sns_message_discover_pdr.txt'
  ), 'utf8');

  const event = JSON.parse(JSON.parse(txt.toString()));
  const resp = await indexer.handler(event, {}, () => {});

  t.is(resp.length, 1);
  t.truthy(resp[0].sf);
  t.falsy(resp[0].granule);
  t.falsy(resp[0].pdr);
});
