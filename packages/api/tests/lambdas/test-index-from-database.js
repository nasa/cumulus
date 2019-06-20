'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const indexFromDatabase = require('../../lambdas/index-from-database');

const models = require('../../models');
const {
  fakeCollectionFactoryV2,
  fakeGranuleFactoryV2,
  fakeExecutionFactoryV2
} = require('../../lib/testUtils');
const bootstrap = require('../../lambdas/bootstrap');
const indexer = require('../../es/indexer');
const { Search } = require('../../es/search');

// create all the variables needed across this test
let esClient;
let esIndex;
const fakeExecutions = [];

process.env.ExecutionsTable = randomString();
process.env.CollectionsTable = randomString();

const executionModel = new models.Execution();
const collectionModel = new models.Collection();

async function addFakeData(numItems, factory, model) {
  const items = [];

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < numItems; i += 1) {
    const item = factory();
    items.push(item);
    await model.create(item);
  }
  /* eslint-enable no-await-in-loop */

  return items;
}

function searchEs(type) {
  const executionQuery = new Search({}, type, esIndex);
  return executionQuery.query();
}

test.before(async () => {
  esIndex = randomString();
  // create esClient
  esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  await executionModel.createTable();
  await collectionModel.createTable();
});

test.after.always(async () => {
  await esClient.indices.delete({ index: esIndex });

  await executionModel.deleteTable();
});

test('index executions', async (t) => {
  const numItems = 10;

  const fakeData = await Promise.all([
    addFakeData(numItems, fakeExecutionFactoryV2, executionModel)
  ]);

  await indexFromDatabase.indexFromDatabase(esIndex);

  const searchResults = await Promise.all([
    searchEs('execution')
  ]);

  searchResults.map((res) => t.is(res.meta.count, numItems));

  searchResults.map((res, index) =>
    t.deepEqual(
      res.results.map((r) => delete r.timestamp),
      fakeData[index].map((r) => delete r.timestamp)
    ));
});
