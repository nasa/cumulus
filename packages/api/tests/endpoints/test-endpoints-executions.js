'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');
const bootstrap = require('../../lambdas/bootstrap');
const executionEndpoint = require('../../endpoints/executions');
const indexer = require('../../es/indexer');
const { testEndpoint, fakeExecutionFactory } = require('../../lib/testUtils');
const { Search } = require('../../es/search');

// create all the variables needed across this test
let esClient;
const fakeExecutions = [];
const esIndex = randomString();
process.env.ExecutionsTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();

let ex;
test.before(async () => {
  // create esClient
  esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  // create a fake bucket
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();

  // create fake granule table
  ex = new models.Execution();
  await ex.createTable();

  // create fake granule records
  fakeExecutions.push(fakeExecutionFactory('completed'));
  fakeExecutions.push(fakeExecutionFactory('failed', 'workflow2'));
  await Promise.all(fakeExecutions.map((i) => ex.create(i)
    .then((record) => indexer.indexExecution(esClient, record, esIndex))));
});

test.after.always(async () => {
  await ex.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await aws.recursivelyDeleteS3Bucket(process.env.internal);
});


test('default returns list of executions', (t) => {
  const listEvent = { httpMethod: 'list' };
  return testEndpoint(executionEndpoint, listEvent, (response) => {
    const { meta, results } = JSON.parse(response.body);
    t.is(results.length, 2);
    t.is(meta.stack, process.env.stackName);
    t.is(meta.table, 'execution');
    t.is(meta.count, 2);
    const arns = fakeExecutions.map((i) => i.arn);
    results.forEach((r) => {
      t.true(arns.includes(r.arn));
    });
  });
});

test('executions can be filtered by workflow', (t) => {
  const listEvent = {
    httpMethod: 'list',
    queryStringParameters: { type: 'workflow2' }
  };
  return testEndpoint(executionEndpoint, listEvent, (response) => {
    const { meta, results } = JSON.parse(response.body);
    t.is(results.length, 1);
    t.is(meta.stack, process.env.stackName);
    t.is(meta.table, 'execution');
    t.is(meta.count, 1);
    t.is(fakeExecutions[1].arn, results[0].arn);
  });
});

test('GET returns an existing execution', (t) => {
  const getEvent = {
    httpMethod: 'GET',
    pathParameters: {
      arn: fakeExecutions[0].arn
    }
  };
  return testEndpoint(executionEndpoint, getEvent, (response) => {
    const { arn } = JSON.parse(response.body);
    t.is(arn, fakeExecutions[0].arn);
  });
});

test('GET fails if execution is not found', async (t) => {
  const event = {
    httpMethod: 'GET',
    pathParameters: {
      arn: 'unknown'
    }
  };

  const response = await testEndpoint(executionEndpoint, event, (r) => r);
  t.is(response.statusCode, 400);
  const { message } = JSON.parse(response.body);
  t.true(message.includes('No record found for'));
});
