'use strict';

const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');
const fs = require('fs');
const path = require('path');
const awsServices = require('@cumulus/aws-client/services');
const s3Utils = require('@cumulus/aws-client/S3');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const cmrjs = require('@cumulus/cmrjs');
const { randomString } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/common/collection-config-store');
const workflows = require('@cumulus/common/workflows');

const indexer = rewire('../../es/indexer');
const { Search } = require('../../es/search');
const models = require('../../models');
const { fakeGranuleFactory, fakeCollectionFactory } = require('../../lib/testUtils');
const { IndexExistsError } = require('../../lib/errors');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');

const granuleSuccess = require('../data/granule_success.json');

const esIndex = randomString();
const collectionTable = randomString();
const granuleTable = randomString();
const executionTable = randomString();
const pdrsTable = randomString();

process.env.system_bucket = randomString();
process.env.stackName = randomString();

let esClient;
let collectionModel;
let executionModel;
let granuleModel;
let pdrsModel;
let cmrStub;
let stepFunctionsStub;
let existsStub;
let workflowStub;
let templateStub;

const input = JSON.stringify(granuleSuccess);
const payload = JSON.parse(input);

test.before(async (t) => {
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

  t.context.esAlias = randomString();
  process.env.ES_INDEX = t.context.esAlias;

  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch('fakehost', esIndex, t.context.esAlias);
  esClient = await Search.es();

  // create buckets
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const fakeMetadata = {
    beginningDateTime: '2017-10-24T00:00:00.000Z',
    endingDateTime: '2018-10-24T00:00:00.000Z',
    lastUpdateDateTime: '2018-04-20T21:45:45.524Z',
    productionDateTime: '2018-04-25T21:45:45.524Z'
  };

  cmrStub = sinon.stub(cmrjs, 'getGranuleTemporalInfo').callsFake(() => fakeMetadata);

  stepFunctionsStub = sinon.stub(StepFunctions, 'describeExecution').returns({
    input,
    startDate: new Date(Date.UTC(2019, 6, 28)),
    stopDate: new Date(Date.UTC(2019, 6, 28, 1))
  });

  existsStub = sinon.stub(s3Utils, 'fileExists').returns(true);
  templateStub = sinon.stub(workflows, 'getWorkflowTemplate').returns({});
  workflowStub = sinon.stub(workflows, 'getWorkflowFile').returns({});
});

test.after.always(async () => {
  await collectionModel.deleteTable();
  await executionModel.deleteTable();
  await granuleModel.deleteTable();
  await pdrsModel.deleteTable();

  await esClient.indices.delete({ index: esIndex });
  await s3Utils.recursivelyDeleteS3Bucket(process.env.system_bucket);

  cmrStub.restore();
  stepFunctionsStub.restore();
  existsStub.restore();
  templateStub.restore();
  workflowStub.restore();
});

test.serial('indexing a deletedgranule record', async (t) => {
  const { esAlias } = t.context;

  const granuletype = 'granule';
  const granule = fakeGranuleFactory();
  const collection = fakeCollectionFactory();
  const collectionId = constructCollectionId(collection.name, collection.version);
  granule.collectionId = collectionId;

  // create granule record
  let r = await indexer.indexGranule(esClient, granule, esAlias, granuletype);
  t.is(r.result, 'created');

  r = await indexer.deleteRecord({
    esClient,
    id: granule.granuleId,
    type: granuletype,
    parent: collectionId,
    index: esAlias
  });
  t.is(r.result, 'deleted');

  // the deletedgranule record is added
  const deletedGranParams = {
    index: esAlias,
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
  r = await indexer.indexGranule(esClient, granule, esAlias, granuletype);
  t.is(r.result, 'created');
  record = await esClient.get(deletedGranParams, { ignore: [404] })
    .then((response) => response.body);
  t.false(record.found);
});

test.serial('creating multiple deletedgranule records and retrieving them', async (t) => {
  const { esAlias } = t.context;

  const granuleIds = [];
  const granules = [];

  for (let i = 0; i < 11; i += 1) {
    const newgran = fakeGranuleFactory();
    granules.push(newgran);
    granuleIds.push(newgran.granuleId);
  }

  const collectionId = granules[0].collectionId;

  // add the records
  let response = await Promise.all(granules.map((g) => indexer.indexGranule(esClient, g, esAlias)));
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
        index: esAlias
      })));
  t.is(response.length, 11);
  response.forEach((r) => t.is(r.result, 'deleted'));

  await esClient.indices.refresh();

  // retrieve deletedgranule records which are deleted within certain range
  // and are from a given collection
  const deletedGranParams = {
    index: esAlias,
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
  const { esAlias } = t.context;

  const testRecord = {
    name: randomString()
  };

  const r = await indexer.indexRule(esClient, testRecord, esAlias);

  // make sure record is created
  t.is(r.result, 'created');

  // check the record exists
  const record = await esClient.get({
    index: esAlias,
    type: 'rule',
    id: testRecord.name
  }).then((response) => response.body);

  t.is(record._id, testRecord.name);
  t.is(typeof record._source.timestamp, 'number');
});

test.serial('indexing a provider record', async (t) => {
  const { esAlias } = t.context;

  const testRecord = {
    id: randomString()
  };

  const r = await indexer.indexProvider(esClient, testRecord, esAlias);

  // make sure record is created
  t.is(r.result, 'created');

  // check the record exists
  const record = await esClient.get({
    index: esAlias,
    type: 'provider',
    id: testRecord.id
  }).then((response) => response.body);

  t.is(record._id, testRecord.id);
  t.is(typeof record._source.timestamp, 'number');
});

test.serial('indexing a collection record', async (t) => {
  const { esAlias } = t.context;

  const collection = {
    name: randomString(),
    version: '001'
  };

  const collectionId = constructCollectionId(collection.name, collection.version);
  const r = await indexer.indexCollection(esClient, collection, esAlias);

  // make sure record is created
  t.is(r.result, 'created');

  // check the record exists
  const record = await esClient.get({
    index: esAlias,
    type: 'collection',
    id: collectionId
  }).then((response) => response.body);

  t.is(record._id, collectionId);
  t.is(record._source.name, collection.name);
  t.is(record._source.version, collection.version);
  t.is(typeof record._source.timestamp, 'number');
});

test.serial('indexing collection records with different versions', async (t) => {
  const { esAlias } = t.context;

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

    const r = await indexer.indexCollection(esClient, collection, esAlias);
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
      index: esAlias,
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
  const { esAlias } = t.context;

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
  let r = await indexer.indexCollection(esClient, collection, esAlias);

  // make sure record is created
  t.is(r.result, 'created');

  // update the collection record
  r = await indexer.indexCollection(esClient, updatedCollection, esAlias);
  t.is(r.result, 'updated');

  // check the record exists
  const record = await esClient.get({
    index: esAlias,
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
  const { esAlias } = t.context;

  const testRecord = {
    id: randomString()
  };
  const type = 'provider';

  let r = await indexer.indexProvider(esClient, testRecord, esAlias, type);

  // make sure record is created
  t.is(r.result, 'created');
  t.is(r._id, testRecord.id);

  r = await indexer.deleteRecord({
    esClient,
    id: testRecord.id,
    type,
    index: esAlias
  });

  t.is(r.result, 'deleted');

  await t.throwsAsync(
    () => esClient.get({ index: esAlias, type, id: testRecord.id }),
    'Response Error'
  );
});

// This needs to be serial because it is stubbing aws.sfn's responses
test.serial('reingest a granule', async (t) => {
  payload.payload.granules[0].granuleId = randomString();
  const records = await granuleModel.createGranulesFromSns(payload);
  const record = records[0];

  t.is(record.status, 'completed');

  await indexer.reingest(record);

  const g = new models.Granule();
  const newRecord = await g.get({ granuleId: record.granuleId });

  t.is(newRecord.status, 'running');
});

test.serial('indexing a granule record', async (t) => {
  const { esAlias } = t.context;

  const txt = fs.readFileSync(
    path.join(__dirname, '../data/sns_message_granule.txt'),
    'utf8'
  );

  const event = JSON.parse(JSON.parse(txt.toString()));
  const msg = JSON.parse(event.Records[0].Sns.Message);

  const [granule] = await granuleModel.createGranulesFromSns(msg);
  await indexer.indexGranule(esClient, granule, esAlias);

  const collection = msg.meta.collection;
  const collectionId = constructCollectionId(collection.name, collection.version);

  // test granule record is added
  const record = await esClient.get({
    index: esAlias,
    type: 'granule',
    id: granule.granuleId,
    parent: collectionId
  }).then((response) => response.body);
  t.is(record._id, granule.granuleId);
});

test.serial('indexing a PDR record', async (t) => {
  const { esAlias } = t.context;

  const txt = fs.readFileSync(
    path.join(__dirname, '../data/sns_message_parse_pdr.txt'),
    'utf8'
  );

  const event = JSON.parse(JSON.parse(txt.toString()));
  const msg = JSON.parse(event.Records[0].Sns.Message);

  const pdr = await pdrsModel.createPdrFromSns(msg);

  // fake pdr index to elasticsearch (this is done in a lambda function)
  await indexer.indexPdr(esClient, pdr, esAlias);

  // test granule record is added
  const record = await esClient.get({
    index: esAlias,
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

test.serial('parsePayload correctly parses AWS Linux style console output', async (t) => {
  const parsePayload = indexer.__get__('parsePayload');
  const expected = {
    some: 'key',
    sender: 'some sender',
    message: 'a messaage',
    RequestId: 'a714a0ef-f141-4e52-9661-58ca2233959a'
  };
  const actual = parsePayload({ sender: 'fixture_sender', message: '2018-06-01T17:45:27.108Z\ta714a0ef-f141-4e52-9661-58ca2233959a\t{"some": "key", "sender": "some sender", "message": "a messaage"}' });
  t.deepEqual(actual, expected);
});

test.serial('parsePayload correctly parses AWS Linux 2 style console output', async (t) => {
  const parsePayload = indexer.__get__('parsePayload');
  const expected = {
    some: 'key',
    sender: 'some sender',
    message: 'a messaage',
    RequestId: 'a714a0ef-f141-4e52-9661-58ca2233959a'
  };
  const actual = parsePayload({ sender: 'fixture_sender', message: '2018-06-01T17:45:27.108Z\ta714a0ef-f141-4e52-9661-58ca2233959a\tINFO\t{"some": "key", "sender": "some sender", "message": "a messaage"}' });
  t.deepEqual(actual, expected);
});


test.serial('parsePayload correctly handles unparseable record', async (t) => {
  const parsePayload = indexer.__get__('parsePayload');
  const testPayload = {
    message: 'INFO MESSAGE',
    sender: 'AWS sender',
    executions: 'some execution value',
    timestamp: '2018-06-01T17:45:27.108Z',
    version: '1'
  };
  const expected = {
    message: 'INFO MESSAGE',
    sender: 'AWS sender',
    executions: 'some execution value',
    timestamp: '2018-06-01T17:45:27.108Z',
    version: '1',
    level: 30,
    pid: 1,
    name: 'cumulus'
  };
  const actual = parsePayload(testPayload);
  t.deepEqual(actual, expected);
});
