'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const indexFromDatabase = require('../../lambdas/index-from-database');

const models = require('../../models');
const {
  fakeExecutionFactory
} = require('../../lib/testUtils');
const bootstrap = require('../../lambdas/bootstrap');
const indexer = require('../../es/indexer');
const { Search } = require('../../es/search');

// create all the variables needed across this test
let esClient;
let esIndex;
const fakeExecutions = [];
process.env.ExecutionsTable = randomString();

test.before(async () => {
  esIndex = randomString();
  // create esClient
  esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);
});

test('index executions', async (t) => {
  const executionModel = new models.Execution();
  await executionModel.createTable();

  fakeExecutions.push(fakeExecutionFactory('completed'));
  fakeExecutions.push(fakeExecutionFactory('failed', 'workflow2'));
  await Promise.all(fakeExecutions.map((i) => executionModel.create(i)
    .then((record) => indexer.indexExecution(esClient, record, esIndex))));

  await indexFromDatabase.testIndex();
});
