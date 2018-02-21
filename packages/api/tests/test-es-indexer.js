'use strict';

const test = require('ava');
const indexer = require('../es/indexer');
const { Search } = require('../es/search');
const { bootstrapElasticSearch } = require('../lambdas/bootstrap');
const { randomString } = require('@cumulus/common/test-utils');
const granuleSuccess = require('./data/granule_success.json');
const granuleFailure = require('./data/granule_failed.json');

const esIndex = randomString();
let esClient;


test.before(async () => {
  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch('fakehost', esIndex);
  esClient = await Search.es();
});

test.after.always(async () => {
  // remove elasticsearch index
  await esClient.indices.delete({ index: esIndex });
});

test('test indexing a successful granule record', async (t) => {
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

  t.deepEqual(record._source.files, granule.files);
  t.is(record._source.status, 'completed');
  t.is(record._parent, collectionId);
  t.is(record._id, granule.granuleId);
  t.is(record._source.cmrLink, granule.cmrLink);
  t.is(record._source.published, granule.published);

  const { name: deconstructed } = indexer.deconstructCollectionId(record._parent);
  t.is(deconstructed, collection.name);
});

test('test indexing multiple successful granule records', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(granuleSuccess));
  const type = 'granule';
  const granule = newPayload.payload.granules[0];
  granule.granuleId = randomString();
  const granule2 = Object.assign({}, granule);
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

test('test indexing a failed granule record', async (t) => {
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
  t.is(record._source.error, JSON.stringify(granuleFailure.exception));
});

test('test indexing a granule record without state_machine info', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(granuleSuccess));
  const type = 'granule';
  delete newPayload.cumulus_meta.state_machine;

  const r = await indexer.granule(esClient, newPayload, esIndex, type);
  t.is(r, undefined);
});

test('test indexing a granule record without a granule', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(granuleSuccess));
  const type = 'granule';
  delete newPayload.payload;
  delete newPayload.meta;

  const r = await indexer.granule(esClient, newPayload, esIndex, type);
  t.is(r, undefined);
});

test('test indexing a granule record in meta section', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(granuleSuccess));
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

test('test indexing a rule record', async (t) => {
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

test('test indexing a provider record', async (t) => {
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

test('test indexing a collection record', async (t) => {
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
