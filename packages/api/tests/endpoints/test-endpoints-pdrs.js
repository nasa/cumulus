'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');
const bootstrap = require('../../lambdas/bootstrap');
const pdrEndpoint = require('../../endpoints/pdrs');
const indexer = require('../../es/indexer');
const { testEndpoint, fakePdrFactory } = require('../../lib/testUtils');
const { Search } = require('../../es/search');

// create all the variables needed across this test
let esClient;
let fakePdrs;
const esIndex = randomString();
process.env.PdrsTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();

let p;
test.before(async () => {
  // create esClient
  esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  // create a fake bucket
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();

  p = new models.Pdr();
  await p.createTable();

  // create fake granule records
  fakePdrs = ['completed', 'failed'].map(fakePdrFactory);
  await Promise.all(fakePdrs.map((pdr) => p.create(pdr).then((record) => indexer.indexPdr(esClient, record, esIndex))));
});

test.after.always(async () => {
  await p.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await aws.recursivelyDeleteS3Bucket(process.env.internal);
});


test('default returns list of pdrs', (t) => {
  const listEvent = { httpMethod: 'list' };
  return testEndpoint(pdrEndpoint, listEvent, (response) => {
    const { meta, results } = JSON.parse(response.body);
    t.is(results.length, 2);
    t.is(meta.stack, process.env.stackName);
    t.is(meta.table, 'pdr');
    t.is(meta.count, 2);
    const pdrNames = fakePdrs.map((i) => i.pdrName);
    results.forEach((r) => {
      t.true(pdrNames.includes(r.pdrName));
    });
  });
});

test('GET returns an existing pdr', (t) => {
  const getEvent = {
    httpMethod: 'GET',
    pathParameters: {
      pdrName: fakePdrs[0].pdrName
    }
  };
  return testEndpoint(pdrEndpoint, getEvent, (response) => {
    const { pdrName } = JSON.parse(response.body);
    t.is(pdrName, fakePdrs[0].pdrName);
  });
});

test('GET fails if pdr is not found', async (t) => {
  const event = {
    httpMethod: 'GET',
    pathParameters: {
      pdrName: 'unknownPdr'
    }
  };

  const response = await testEndpoint(pdrEndpoint, event, (r) => r);
  t.is(response.statusCode, 400);
  const { message } = JSON.parse(response.body);
  t.true(message.includes('No record found for'));
});

test('DELETE a pdr', async (t) => {
  const newPdr = fakePdrFactory('completed');
  // create a new pdr
  await p.create(newPdr);

  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      pdrName: newPdr.pdrName
    }
  };

  const key = `${process.env.stackName}/pdrs/${newPdr.pdrName}`;
  await aws.s3().putObject({ Bucket: process.env.internal, Key: key, Body: 'test data' }).promise();

  const response = await testEndpoint(pdrEndpoint, deleteEvent, (r) => r);
  t.is(response.statusCode, 200);
  const { detail } = JSON.parse(response.body);
  t.is(
    detail,
    'Record deleted'
  );
});

test('DELETE fails if pdr is not found', async (t) => {
  const event = {
    httpMethod: 'DELETE',
    pathParameters: {
      pdrName: 'unknownPdr'
    }
  };

  const response = await testEndpoint(pdrEndpoint, event, (r) => r);
  t.is(response.statusCode, 400);
  const { message } = JSON.parse(response.body);
  t.true(message.includes('No record found for'));
});
