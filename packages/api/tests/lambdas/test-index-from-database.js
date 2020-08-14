'use strict';

const test = require('ava');
const sinon = require('sinon');
const omit = require('lodash/omit');

const awsServices = require('@cumulus/aws-client/services');
const {
  promiseS3Upload,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const indexFromDatabase = require('../../lambdas/index-from-database');

const models = require('../../models');
const {
  fakeCollectionFactory,
  fakeAsyncOperationFactory,
  fakeExecutionFactoryV2,
  fakeGranuleFactoryV2,
  fakePdrFactoryV2,
  fakeProviderFactory,
  fakeReconciliationReportFactory,
  fakeRuleFactoryV2,
  getWorkflowList,
} = require('../../lib/testUtils');
const bootstrap = require('../../lambdas/bootstrap');
const indexer = require('../../es/indexer');
const { Search } = require('../../es/search');

const workflowList = getWorkflowList();

// create all the variables needed across this test
process.env.system_bucket = randomString();
process.env.stackName = randomString();

process.env.ExecutionsTable = randomString();
process.env.AsyncOperationsTable = randomString();
process.env.CollectionsTable = randomString();
process.env.GranulesTable = randomString();
process.env.PdrsTable = randomString();
process.env.ProvidersTable = randomString();
process.env.ReconciliationReportsTable = randomString();
process.env.RulesTable = randomString();

const tables = {
  collectionsTable: process.env.CollectionsTable,
  executionsTable: process.env.ExecutionsTable,
  asyncOperationsTable: process.env.AsyncOperationsTable,
  granulesTable: process.env.GranulesTable,
  pdrsTable: process.env.PdrsTable,
  providersTable: process.env.ProvidersTable,
  reconciliationReportsTable: process.env.ReconciliationReportsTable,
  rulesTable: process.env.RulesTable,
};

const executionModel = new models.Execution();
const asyncOperationModel = new models.AsyncOperation({
  systemBucket: process.env.system_bucket,
  stackName: process.env.stackName,
  tableName: process.env.AsyncOperationsTable,
});
const collectionModel = new models.Collection();
const granuleModel = new models.Granule();
const pdrModel = new models.Pdr();
const providersModel = new models.Provider();
const reconciliationReportModel = new models.ReconciliationReport();
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

function searchEs(type, index) {
  const executionQuery = new Search({}, type, index);
  return executionQuery.query();
}

test.before(async (t) => {
  t.context.esIndex = randomString();
  t.context.esAlias = randomString();

  t.context.esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', t.context.esIndex, t.context.esAlias);

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  await executionModel.createTable();
  await asyncOperationModel.createTable();
  await collectionModel.createTable();
  await granuleModel.createTable();
  await pdrModel.createTable();
  await providersModel.createTable();
  await reconciliationReportModel.createTable();
  await rulesModel.createTable();

  const wKey = `${process.env.stackName}/workflows/${workflowList[0].name}.json`;
  const tKey = `${process.env.stackName}/workflow_template.json`;
  await Promise.all([
    promiseS3Upload({
      Bucket: process.env.system_bucket,
      Key: wKey,
      Body: JSON.stringify(workflowList[0]),
    }),
    promiseS3Upload({
      Bucket: process.env.system_bucket,
      Key: tKey,
      Body: JSON.stringify({}),
    }),
  ]);
});

test.after.always(async (t) => {
  const { esClient, esIndex } = t.context;

  await esClient.indices.delete({ index: esIndex });

  await executionModel.deleteTable();
  await asyncOperationModel.deleteTable();
  await collectionModel.deleteTable();
  await granuleModel.deleteTable();
  await pdrModel.deleteTable();
  await providersModel.deleteTable();
  await reconciliationReportModel.deleteTable();
  await rulesModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('getEsRequestConcurrency respects concurrency value in payload', (t) => {
  t.is(indexFromDatabase.getEsRequestConcurrency({
    esRequestConcurrency: 5,
  }), 5);
});

test.serial('getEsRequestConcurrency respects ES_CONCURRENCY environment variable', (t) => {
  process.env.ES_CONCURRENCY = 35;
  t.is(indexFromDatabase.getEsRequestConcurrency({}), 35);
  delete process.env.ES_CONCURRENCY;
});

test('getEsRequestConcurrency correctly returns 10 when nothing is specified', (t) => {
  t.is(indexFromDatabase.getEsRequestConcurrency({}), 10);
});

test.serial('getEsRequestConcurrency throws an error when -1 is specified', (t) => {
  t.throws(
    () => indexFromDatabase.getEsRequestConcurrency({
      esRequestConcurrency: -1,
    }),
    { instanceOf: TypeError }
  );

  process.env.ES_CONCURRENCY = -1;
  t.teardown(() => {
    delete process.env.ES_CONCURRENCY;
  });
  t.throws(
    () => indexFromDatabase.getEsRequestConcurrency({}),
    { instanceOf: TypeError }
  );
});

test.serial('getEsRequestConcurrency throws an error when "asdf" is specified', (t) => {
  t.throws(
    () => indexFromDatabase.getEsRequestConcurrency({
      esRequestConcurrency: 'asdf',
    }),
    { instanceOf: TypeError }
  );

  process.env.ES_CONCURRENCY = 'asdf';
  t.teardown(() => {
    delete process.env.ES_CONCURRENCY;
  });
  t.throws(
    () => indexFromDatabase.getEsRequestConcurrency({}),
    { instanceOf: TypeError }
  );
});

test.serial('getEsRequestConcurrency throws an error when 0 is specified', (t) => {
  t.throws(
    () => indexFromDatabase.getEsRequestConcurrency({
      esRequestConcurrency: 0,
    }),
    { instanceOf: TypeError }
  );

  process.env.ES_CONCURRENCY = 0;
  t.teardown(() => {
    delete process.env.ES_CONCURRENCY;
  });
  t.throws(
    () => indexFromDatabase.getEsRequestConcurrency({}),
    { instanceOf: TypeError }
  );
});

test('No error is thrown if nothing is in the database', async (t) => {
  const { esAlias } = t.context;

  t.notThrows(async () => indexFromDatabase.indexFromDatabase({
    indexName: esAlias,
    tables,
  }));
});

test('Lambda successfully indexes records of all types', async (t) => {
  const { esAlias } = t.context;

  const numItems = 1;

  const fakeData = await Promise.all([
    addFakeData(numItems, fakeCollectionFactory, collectionModel),
    addFakeData(numItems, fakeExecutionFactoryV2, executionModel),
    addFakeData(numItems, fakeAsyncOperationFactory, asyncOperationModel),
    addFakeData(numItems, fakeGranuleFactoryV2, granuleModel),
    addFakeData(numItems, fakePdrFactoryV2, pdrModel),
    addFakeData(numItems, fakeProviderFactory, providersModel),
    addFakeData(numItems, fakeReconciliationReportFactory, reconciliationReportModel),
    addFakeData(numItems, fakeRuleFactoryV2, rulesModel, { workflow: workflowList[0].name }),
  ]);

  await indexFromDatabase.handler({
    indexName: esAlias,
    tables,
  });

  const searchResults = await Promise.all([
    searchEs('collection', esAlias),
    searchEs('execution', esAlias),
    searchEs('granule', esAlias),
    searchEs('pdr', esAlias),
    searchEs('provider', esAlias),
    searchEs('reconciliationReport', esAlias),
    searchEs('rule', esAlias),
  ]);

  searchResults.map((res) => t.is(res.meta.count, numItems));

  searchResults.map((res, index) =>
    t.deepEqual(
      res.results.map((r) => delete r.timestamp),
      fakeData[index].map((r) => delete r.timestamp)
    ));
});

test.serial('failure in indexing record of specific type should not prevent indexing of other records with same type', async (t) => {
  const { esAlias, esClient } = t.context;

  const numItems = 7;
  const fakeData = await addFakeData(numItems, fakeGranuleFactoryV2, granuleModel);

  let numCalls = 0;
  const originalIndexGranule = indexer.indexGranule;
  const successCount = 4;
  const indexGranuleStub = sinon.stub(indexer, 'indexGranule')
    .callsFake((
      esClientArg,
      payload,
      index
    ) => {
      numCalls += 1;
      if (numCalls <= successCount) {
        return originalIndexGranule(esClientArg, payload, index);
      }
      throw new Error('fake error');
    });

  let searchResults;
  try {
    await indexFromDatabase.handler({
      indexName: esAlias,
      tables,
    });

    searchResults = await searchEs('granule', esAlias);

    t.is(searchResults.meta.count, successCount);

    searchResults.results.forEach((result) => {
      const sourceData = fakeData.find((data) => data.granuleId === result.granuleId);
      t.deepEqual(
        omit(sourceData, ['timestamp', 'updatedAt']),
        omit(result, ['timestamp', 'updatedAt'])
      );
    });
  } finally {
    indexGranuleStub.restore();
    await Promise.all(fakeData.map(
      ({ granuleId }) => granuleModel.delete({ granuleId })
    ));
    await Promise.all(searchResults.results.map(
      (result) =>
        esClient.delete({
          index: esAlias,
          type: 'granule',
          id: result.granuleId,
          parent: result.collectionId,
          refresh: true,
        })
    ));
  }
});

test.serial('failure in indexing record of one type should not prevent indexing of other records with different type', async (t) => {
  const { esAlias, esClient } = t.context;

  const numItems = 2;
  const [fakeProviderData, fakeGranuleData] = await Promise.all([
    addFakeData(numItems, fakeProviderFactory, providersModel),
    addFakeData(numItems, fakeGranuleFactoryV2, granuleModel),
  ]);

  const indexGranuleStub = sinon.stub(indexer, 'indexGranule')
    .throws(new Error('error'));

  let searchResults;
  try {
    await indexFromDatabase.handler({
      indexName: esAlias,
      tables,
    });

    searchResults = await searchEs('provider', esAlias);

    t.is(searchResults.meta.count, numItems);

    searchResults.results.forEach((result) => {
      const sourceData = fakeProviderData.find((data) => data.id === result.id);
      t.deepEqual(
        omit(sourceData, ['createdAt', 'timestamp', 'updatedAt']),
        omit(result, ['createdAt', 'timestamp', 'updatedAt'])
      );
    });
  } finally {
    indexGranuleStub.restore();
    await Promise.all(fakeProviderData.map(
      ({ id }) => providersModel.delete({ id })
    ));
    await Promise.all(fakeGranuleData.map(
      ({ granuleId }) => granuleModel.delete({ granuleId })
    ));
    await Promise.all(searchResults.results.map(
      (result) =>
        esClient.delete({
          index: esAlias,
          type: 'provider',
          id: result.id,
          refresh: true,
        })
    ));
  }
});
