'use strict';

const test = require('ava');

const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const indexFromDatabase = require('../../lambdas/index-from-database');

const models = require('../../models');
const {
  fakeCollectionFactory,
  fakeExecutionFactoryV2,
  fakeGranuleFactoryV2,
  fakePdrFactoryV2,
  fakeProviderFactory,
  fakeRuleFactoryV2,
  getWorkflowList
} = require('../../lib/testUtils');
const bootstrap = require('../../lambdas/bootstrap');
const { Search } = require('../../es/search');

const workflowList = getWorkflowList();
// create all the variables needed across this test
let esClient;
let esIndex;

process.env.system_bucket = randomString();
process.env.stackName = randomString();

process.env.ExecutionsTable = randomString();
process.env.CollectionsTable = randomString();
process.env.GranulesTable = randomString();
process.env.PdrsTable = randomString();
process.env.ProvidersTable = randomString();
process.env.RulesTable = randomString();

const tables = {
  collectionsTable: process.env.CollectionsTable,
  executionsTable: process.env.ExecutionsTable,
  granulesTable: process.env.GranulesTable,
  pdrsTable: process.env.PdrsTable,
  providersTable: process.env.ProvidersTable,
  rulesTable: process.env.RulesTable
};

const executionModel = new models.Execution();
const collectionModel = new models.Collection();
const granuleModel = new models.Granule();
const pdrModel = new models.Pdr();
const providersModel = new models.Provider();
const rulesModel = new models.Rule();

async function addFakeData(numItems, factory, model, factoryParams = {}) {
  const items = [];

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < numItems; i += 1) {
    const item = factory(factoryParams);
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

  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  await executionModel.createTable();
  await collectionModel.createTable();
  await granuleModel.createTable();
  await pdrModel.createTable();
  await providersModel.createTable();
  await rulesModel.createTable();

  const wKey = `${process.env.stackName}/workflows/${workflowList[0].name}.json`;
  const tKey = `${process.env.stackName}/workflow_template.json`;
  await Promise.all([
    aws.promiseS3Upload({
      Bucket: process.env.system_bucket,
      Key: wKey,
      Body: JSON.stringify(workflowList[0])
    }),
    aws.promiseS3Upload({
      Bucket: process.env.system_bucket,
      Key: tKey,
      Body: JSON.stringify({})
    })
  ]);
});

test.after.always(async () => {
  await esClient.indices.delete({ index: esIndex });

  await executionModel.deleteTable();
  await collectionModel.deleteTable();
  await granuleModel.deleteTable();
  await pdrModel.deleteTable();
  await providersModel.deleteTable();
  await rulesModel.deleteTable();

  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('No error is thrown if nothing is in the database', async (t) => {
  t.notThrows(async () => indexFromDatabase.indexFromDatabase(esIndex, tables));
});

test('index executions', async (t) => {
  const numItems = 1;

  const fakeData = await Promise.all([
    addFakeData(numItems, fakeCollectionFactory, collectionModel),
    addFakeData(numItems, fakeExecutionFactoryV2, executionModel),
    addFakeData(numItems, fakeGranuleFactoryV2, granuleModel),
    addFakeData(numItems, fakePdrFactoryV2, pdrModel),
    addFakeData(numItems, fakeProviderFactory, providersModel),
    addFakeData(numItems, fakeRuleFactoryV2, rulesModel, { workflow: workflowList[0].name })
  ]);

  await indexFromDatabase.indexFromDatabase(esIndex, tables);

  const searchResults = await Promise.all([
    searchEs('collection'),
    searchEs('execution'),
    searchEs('granule'),
    searchEs('pdr'),
    searchEs('provider'),
    searchEs('rule')
  ]);

  searchResults.map((res) => t.is(res.meta.count, numItems));

  searchResults.map((res, index) =>
    t.deepEqual(
      res.results.map((r) => delete r.timestamp),
      fakeData[index].map((r) => delete r.timestamp)
    ));
});
