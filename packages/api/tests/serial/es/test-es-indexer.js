'use strict';

const test = require('ava');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const aws = require('@cumulus/common/aws');
const cmrjs = require('@cumulus/cmrjs');
const { randomString } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/common/collection-config-store');
const { noop } = require('@cumulus/common/util');
const StepFunctions = require('@cumulus/common/StepFunctions');

const indexer = require('../../../es/indexer');
const { Search } = require('../../../es/search');
const models = require('../../../models');
const { fakeGranuleFactory, fakeCollectionFactory, deleteAliases } = require('../../../lib/testUtils');
const { IndexExistsError } = require('../../../lib/errors');
const { bootstrapElasticSearch } = require('../../../lambdas/bootstrap');

const granuleSuccess = require('../../data/granule_success.json');

const esIndex = randomString();
const collectionTable = randomString();
const granuleTable = randomString();
const executionTable = randomString();
const pdrsTable = randomString();

process.env.system_bucket = randomString();
process.env.stackName = randomString();
process.env.ES_INDEX = esIndex;

let esClient;
let collectionModel;
let executionModel;
let granuleModel;
let pdrsModel;
let stepFunctionsStub;

const input = JSON.stringify(granuleSuccess);
const payload = JSON.parse(input);

test.before(async () => {
  await deleteAliases();

  // create the tables
  process.env.CollectionsTable = collectionTable;
  collectionModel = new models.Collection();
  await collectionModel.createTable();

  process.env.ExecutionsTable = executionTable;
  executionModel = new models.Execution();
  await executionModel.createTable();

  process.env.GranulesTable = granuleTable;
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  process.env.PdrsTable = pdrsTable;
  pdrsModel = new models.Pdr();
  await pdrsModel.createTable();

  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch('fakehost', esIndex);
  process.env.esIndex = esIndex;
  esClient = await Search.es();

  // create buckets
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const fakeMetadata = {
    beginningDateTime: '2017-10-24T00:00:00.000Z',
    endingDateTime: '2018-10-24T00:00:00.000Z',
    lastUpdateDateTime: '2018-04-20T21:45:45.524Z',
    productionDateTime: '2018-04-25T21:45:45.524Z'
  };

  sinon.stub(cmrjs, 'getGranuleTemporalInfo').callsFake(() => fakeMetadata);

  stepFunctionsStub = sinon.stub(StepFunctions, 'describeExecution').returns({
    input,
    startDate: new Date(Date.UTC(2019, 6, 28)),
    stopDate: new Date(Date.UTC(2019, 6, 28, 1))
  });
});

test.after.always(async () => {
  await collectionModel.deleteTable();
  await executionModel.deleteTable();
  await granuleModel.deleteTable();
  await pdrsModel.deleteTable();

  await esClient.indices.delete({ index: esIndex });
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);

  cmrjs.getGranuleTemporalInfo.restore();
  stepFunctionsStub.restore();
});

test.serial('indexing a deletedgranule record', async (t) => {
  const granuletype = 'granule';
  const granule = fakeGranuleFactory();
  const collection = fakeCollectionFactory();
  const collectionId = constructCollectionId(collection.name, collection.version);
  granule.collectionId = collectionId;

  // create granule record
  let r = await indexer.indexGranule(esClient, granule, esIndex, granuletype);
  t.is(r.result, 'created');

  r = await indexer.deleteRecord({
    esClient,
    id: granule.granuleId,
    type: granuletype,
    parent: collectionId,
    index: esIndex
  });
  t.is(r.result, 'deleted');

  // the deletedgranule record is added
  const deletedGranParams = {
    index: esIndex,
    type: 'deletedgranule',
    id: granule.granuleId,
    parent: collectionId
  };

  let record = await esClient.get(deletedGranParams)
    .then((response) => response.body);
  t.true(record.found);
  t.deepEqual(record._source.files, granule.files);
  t.is(record._parent, collectionId);
  t.is(record._id, granule.granuleId);
  t.truthy(record._source.deletedAt);

  // the deletedgranule record is removed if the granule is ingested again
  r = await indexer.indexGranule(esClient, granule, esIndex, granuletype);
  t.is(r.result, 'created');
  record = await esClient.get(deletedGranParams, { ignore: [404] })
    .then((response) => response.body);
  t.false(record.found);
});

test.serial('creating multiple deletedgranule records and retrieving them', async (t) => {
  const granuleIds = [];
  const granules = [];

  for (let i = 0; i < 11; i += 1) {
    const newgran = fakeGranuleFactory();
    granules.push(newgran);
    granuleIds.push(newgran.granuleId);
  }

  const collectionId = granules[0].collectionId;

  // add the records
  let response = await Promise.all(granules.map((g) => indexer.indexGranule(esClient, g, esIndex)));
  t.is(response.length, 11);
  await esClient.indices.refresh();

  // now delete the records
  response = await Promise.all(granules
    .map((g) => indexer
      .deleteRecord({
        esClient,
        id: g.granuleId,
        type: 'granule',
        parent: g.collectionId,
        index: esIndex
      })));
  t.is(response.length, 11);
  response.forEach((r) => t.is(r.result, 'deleted'));

  await esClient.indices.refresh();

  // retrieve deletedgranule records which are deleted within certain range
  // and are from a given collection
  const deletedGranParams = {
    index: esIndex,
    type: 'deletedgranule',
    body: {
      query: {
        bool: {
          must: [
            {
              range: {
                deletedAt: {
                  gte: 'now-1d',
                  lte: 'now+1s'
                }
              }
            },
            {
              parent_id: {
                type: 'deletedgranule',
                id: collectionId
              }
            }]
        }
      }
    }
  };

  response = await esClient.search(deletedGranParams)
    .then((searchResponse) => searchResponse.body);
  t.is(response.hits.total, 11);
  response.hits.hits.forEach((r) => {
    t.is(r._parent, collectionId);
    t.true(granuleIds.includes(r._source.granuleId));
  });
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
  }).then((response) => response.body);

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
  }).then((response) => response.body);

  t.is(record._id, testRecord.id);
  t.is(typeof record._source.timestamp, 'number');
});

test.serial('indexing a collection record', async (t) => {
  const collection = {
    name: randomString(),
    version: '001'
  };

  const collectionId = constructCollectionId(collection.name, collection.version);
  const r = await indexer.indexCollection(esClient, collection, esIndex);

  // make sure record is created
  t.is(r.result, 'created');

  // check the record exists
  const record = await esClient.get({
    index: esIndex,
    type: 'collection',
    id: collectionId
  }).then((response) => response.body);

  t.is(record._id, collectionId);
  t.is(record._source.name, collection.name);
  t.is(record._source.version, collection.version);
  t.is(typeof record._source.timestamp, 'number');
});

test.serial('indexing collection records with different versions', async (t) => {
  const name = randomString();
  /* eslint-disable no-await-in-loop */
  for (let i = 1; i < 11; i += 1) {
    const version = `00${i}`;
    const key = `key${i}`;
    const value = `value${i}`;
    const collection = {
      name: name,
      version: version,
      [`${key}`]: value
    };

    const r = await indexer.indexCollection(esClient, collection, esIndex);
    // make sure record is created
    t.is(r.result, 'created');
  }
  /* eslint-enable no-await-in-loop */

  await esClient.indices.refresh();
  // check each record exists and is not affected by other collections
  for (let i = 1; i < 11; i += 1) {
    const version = `00${i}`;
    const key = `key${i}`;
    const value = `value${i}`;
    const collectionId = constructCollectionId(name, version);
    const record = await esClient.get({ // eslint-disable-line no-await-in-loop
      index: esIndex,
      type: 'collection',
      id: collectionId
    }).then((response) => response.body);

    t.is(record._id, collectionId);
    t.is(record._source.name, name);
    t.is(record._source.version, version);
    t.is(record._source[key], value);
    t.is(typeof record._source.timestamp, 'number');
  }
});

test.serial('updating a collection record', async (t) => {
  const collection = {
    name: randomString(),
    version: '001',
    anyObject: {
      key: 'value',
      key1: 'value1',
      key2: 'value2'
    },
    anyKey: 'anyValue'
  };

  // updatedCollection has some parameters removed
  const updatedCollection = {
    name: collection.name,
    version: '001',
    anyparams: {
      key1: 'value1'
    }
  };

  const collectionId = constructCollectionId(collection.name, collection.version);
  let r = await indexer.indexCollection(esClient, collection, esIndex);

  // make sure record is created
  t.is(r.result, 'created');

  // update the collection record
  r = await indexer.indexCollection(esClient, updatedCollection, esIndex);
  t.is(r.result, 'updated');

  // check the record exists
  const record = await esClient.get({
    index: esIndex,
    type: 'collection',
    id: collectionId
  }).then((response) => response.body);

  t.is(record._id, collectionId);
  t.is(record._source.name, updatedCollection.name);
  t.is(record._source.version, updatedCollection.version);
  t.deepEqual(record._source.anyparams, updatedCollection.anyparams);
  t.is(record._source.anyKey, undefined);
  t.is(typeof record._source.timestamp, 'number');
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

  r = await indexer.deleteRecord({
    esClient,
    id: testRecord.id,
    type,
    index: esIndex
  });

  t.is(r.result, 'deleted');

  await t.throwsAsync(
    () => esClient.get({ index: esIndex, type, id: testRecord.id }),
    'Response Error'
  );
});

// This needs to be serial because it is stubbing aws.sfn's responses
test.serial('reingest a granule', async (t) => {
  const key = `${process.env.stackName}/workflows/${payload.meta.workflow_name}.json`;
  await aws.s3().putObject({ Bucket: process.env.system_bucket, Key: key, Body: 'test data' }).promise();

  payload.payload.granules[0].granuleId = randomString();
  const records = await granuleModel.createGranulesFromSns(payload);
  const record = records[0];

  t.is(record.status, 'completed');

  await indexer.reingest(record);

  const g = new models.Granule();
  const newRecord = await g.get({ granuleId: record.granuleId });

  t.is(newRecord.status, 'running');
});

test.serial('pass a sns message to main handler', async (t) => {
  const txt = fs.readFileSync(path.join(
    __dirname,
    '../../data/sns_message_granule.txt'
  ), 'utf8');

  const event = JSON.parse(JSON.parse(txt.toString()));
  const resp = await indexer.handler(event, {}, noop);

  t.is(resp.length, 1);
  t.truthy(resp[0].sf);
  t.truthy(resp[0].granule);
  t.falsy(resp[0].pdr);

  // fake granule index to elasticsearch (this is done in a lambda function)
  await indexer.indexGranule(esClient, resp[0].granule[0]);

  const msg = JSON.parse(event.Records[0].Sns.Message);
  const granule = msg.payload.granules[0];
  const collection = msg.meta.collection;
  const collectionId = constructCollectionId(collection.name, collection.version);
  // test granule record is added
  const record = await esClient.get({
    index: esIndex,
    type: 'granule',
    id: granule.granuleId,
    parent: collectionId
  }).then((response) => response.body);
  t.is(record._id, granule.granuleId);
});

test.serial('pass a sns message to main handler with parse info', async (t) => {
  const txt = fs.readFileSync(path.join(
    __dirname,
    '../../data/sns_message_parse_pdr.txt'
  ), 'utf8');

  const event = JSON.parse(JSON.parse(txt.toString()));
  const resp = await indexer.handler(event, {}, noop);

  t.is(resp.length, 1);
  t.truthy(resp[0].sf);
  t.is(resp[0].granule, null);
  t.truthy(resp[0].pdr);

  // fake pdr index to elasticsearch (this is done in a lambda function)
  await indexer.indexPdr(esClient, resp[0].pdr);

  const msg = JSON.parse(event.Records[0].Sns.Message);
  const pdr = msg.payload.pdr;
  // test granule record is added
  const record = await esClient.get({
    index: esIndex,
    type: 'pdr',
    id: pdr.name
  }).then((response) => response.body);
  t.is(record._id, pdr.name);
  t.falsy(record._source.error);
});

test.serial('pass a sns message to main handler with discoverpdr info', async (t) => {
  const txt = fs.readFileSync(path.join(
    __dirname, '../../data/sns_message_discover_pdr.txt'
  ), 'utf8');

  const event = JSON.parse(JSON.parse(txt.toString()));

  const resp = await indexer.handler(event, {}, noop);

  t.is(resp.length, 1);
  t.truthy(resp[0].sf);
  t.is(resp[0].granule, null);
  t.falsy(resp[0].pdr);
});

test.serial('indexing a granule record', async (t) => {
  const txt = fs.readFileSync(path.join(
    __dirname,
    '../../data/sns_message_granule.txt'
  ), 'utf8');

  const event = JSON.parse(JSON.parse(txt.toString()));
  const msg = JSON.parse(event.Records[0].Sns.Message);

  const [granule] = await granuleModel.createGranulesFromSns(msg);
  await indexer.indexGranule(esClient, granule);

  const collection = msg.meta.collection;
  const collectionId = constructCollectionId(collection.name, collection.version);

  // test granule record is added
  const record = await esClient.get({
    index: esIndex,
    type: 'granule',
    id: granule.granuleId,
    parent: collectionId
  }).then((response) => response.body);
  t.is(record._id, granule.granuleId);
});

test.serial('indexing a PDR record', async (t) => {
  const txt = fs.readFileSync(path.join(
    __dirname,
    '../../data/sns_message_parse_pdr.txt'
  ), 'utf8');

  const event = JSON.parse(JSON.parse(txt.toString()));
  const msg = JSON.parse(event.Records[0].Sns.Message);

  const pdr = await pdrsModel.createPdrFromSns(msg);

  // fake pdr index to elasticsearch (this is done in a lambda function)
  await indexer.indexPdr(esClient, pdr);

  // test granule record is added
  const record = await esClient.get({
    index: esIndex,
    type: 'pdr',
    id: pdr.pdrName
  }).then((response) => response.body);
  t.is(record._id, pdr.pdrName);
  t.falsy(record._source.error);
});

test.serial('Create new index', async (t) => {
  const newIndex = randomString();

  await indexer.createIndex(esClient, newIndex);

  const indexExists = await esClient.indices.exists({ index: newIndex })
    .then((response) => response.body);

  t.true(indexExists);

  await esClient.indices.delete({ index: newIndex });
});

test.serial('Create new index - index already exists', async (t) => {
  const newIndex = randomString();

  await indexer.createIndex(esClient, newIndex);

  await t.throwsAsync(
    () => indexer.createIndex(esClient, newIndex),
    IndexExistsError,
    `Index ${newIndex} exists and cannot be created.`
  );

  await esClient.indices.delete({ index: newIndex });
});
