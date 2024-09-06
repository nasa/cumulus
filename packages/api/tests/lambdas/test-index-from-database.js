'use strict';

const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');
const test = require('ava');
const omit = require('lodash/omit');

const awsServices = require('@cumulus/aws-client/services');
const {
  promiseS3Upload,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const indexer = require('@cumulus/es-client/indexer');
const { EsClient, Search } = require('@cumulus/es-client/search');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  migrationDir,
  PdrPgModel,
  ProviderPgModel,
  translatePostgresCollectionToApiCollection,
  translatePostgresExecutionToApiExecution,
  translatePostgresGranuleToApiGranule,
  translatePostgresPdrToApiPdr,
  translatePostgresProviderToApiProvider,
} = require('@cumulus/db');

const {
  fakeReconciliationReportFactory,
} = require('../../lib/testUtils');

const models = require('../../models');
const indexFromDatabase = require('../../lambdas/index-from-database');
const {
  getWorkflowList,
} = require('../../lib/testUtils');

const workflowList = getWorkflowList();
const reconciliationReportModel = new models.ReconciliationReport();

// create all the variables needed across this test
process.env.system_bucket = randomString();
process.env.stackName = randomString();

function sortAndFilter(input, omitList, sortKey) {
  return input.map((r) => omit(r, omitList))
    .sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : -1));
}

async function addFakeDynamoData(numItems, factory, model, factoryParams = {}) {
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

async function addFakeData(knex, numItems, factory, model, factoryParams = {}) {
  const items = [];
  for (let i = 0; i < numItems; i += 1) {
    const item = factory(factoryParams);
    items.push(model.create(knex, item, '*'));
  }
  return (await Promise.all(items)).map((result) => result[0]);
}

function searchEs(type, index, limit = 10) {
  const executionQuery = new Search({ queryStringParameters: { limit } }, type, index);
  return executionQuery.query();
}

test.before(async (t) => {
  t.context.esIndices = [];

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });
  await reconciliationReportModel.createTable();

  const wKey = `${process.env.stackName}/workflows/${workflowList[0].name}.json`;
  const tKey = `${process.env.stackName}/workflow_template.json`;
  await Promise.all([
    promiseS3Upload({
      params: {
        Bucket: process.env.system_bucket,
        Key: wKey,
        Body: JSON.stringify(workflowList[0]),
      },
    }),
    promiseS3Upload({
      params: {
        Bucket: process.env.system_bucket,
        Key: tKey,
        Body: JSON.stringify({}),
      },
    }),
  ]);
});

test.beforeEach(async (t) => {
  t.context.testDbName = `test_index_${cryptoRandomString({ length: 10 })}`;
  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  t.context.esIndex = randomString();
  t.context.esAlias = randomString();
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: t.context.esIndex,
    alias: t.context.esAlias,
  });

  t.context.esClient = new EsClient('fakehost');
  await t.context.esClient.initializeEsClient();
});

test.afterEach.always(async (t) => {
  const { esClient, esIndex, testDbName } = t.context;
  await esClient.client.indices.delete({ index: esIndex });
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.after.always(async () => {
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

test.serial('Lambda successfully indexes records of all types', async (t) => {
  const knex = t.context.knex;
  const { esAlias } = t.context;

  const numItems = 20;

  const fakeData = [];
  const dateObject = { created_at: new Date(), updated_at: new Date() };
  const fakeCollectionRecords = await addFakeData(
    knex,
    numItems,
    fakeCollectionRecordFactory,
    new CollectionPgModel(),
    dateObject
  );
  fakeData.push(fakeCollectionRecords);

  const fakeExecutionRecords = await addFakeData(
    knex,
    numItems,
    fakeExecutionRecordFactory,
    new ExecutionPgModel(),
    { ...dateObject }
  );

  const fakeGranuleRecords = await addFakeData(
    knex,
    numItems,
    fakeGranuleRecordFactory,
    new GranulePgModel(),
    { collection_cumulus_id: fakeCollectionRecords[0].cumulus_id, ...dateObject }
  );

  const fakeProviderRecords = await addFakeData(
    knex,
    numItems,
    fakeProviderRecordFactory,
    new ProviderPgModel(),
    dateObject
  );

  const fakePdrRecords = await addFakeData(knex, numItems, fakePdrRecordFactory, new PdrPgModel(), {
    collection_cumulus_id: fakeCollectionRecords[0].cumulus_id,
    provider_cumulus_id: fakeProviderRecords[0].cumulus_id,
    ...dateObject,
  });

  const fakeReconciliationReportRecords = await addFakeDynamoData(
    numItems,
    fakeReconciliationReportFactory,
    reconciliationReportModel
  );

  await indexFromDatabase.handler({
    indexName: esAlias,
    pageSize: 6,
    knex,
  });

  const searchResults = await Promise.all([
    searchEs('collection', esAlias, '20'),
    searchEs('execution', esAlias, '20'),
    searchEs('granule', esAlias, '20'),
    searchEs('pdr', esAlias, '20'),
    searchEs('provider', esAlias, '20'),
    searchEs('reconciliationReport', esAlias, '20'),
  ]);

  searchResults.map((res) => t.is(res.meta.count, numItems));

  const collectionResults = await Promise.all(
    fakeCollectionRecords.map((r) =>
      translatePostgresCollectionToApiCollection(r))
  );
  const executionResults = await Promise.all(
    fakeExecutionRecords.map((r) => translatePostgresExecutionToApiExecution(r))
  );
  const granuleResults = await Promise.all(
    fakeGranuleRecords.map((r) =>
      translatePostgresGranuleToApiGranule({
        granulePgRecord: r,
        knexOrTransaction: knex,
      }))
  );
  const pdrResults = await Promise.all(
    fakePdrRecords.map((r) => translatePostgresPdrToApiPdr(r, knex))
  );
  const providerResults = await Promise.all(
    fakeProviderRecords.map((r) => translatePostgresProviderToApiProvider(r))
  );

  t.deepEqual(
    searchResults[0].results
      .map((r) => omit(r, ['timestamp']))
      .sort((a, b) => (a.name > b.name ? 1 : -1)),
    collectionResults
      .sort((a, b) => (a.name > b.name ? 1 : -1))
  );

  t.deepEqual(
    sortAndFilter(searchResults[1].results, ['timestamp'], 'name'),
    sortAndFilter(executionResults, ['timestamp'], 'name')
  );

  t.deepEqual(
    sortAndFilter(searchResults[2].results, ['timestamp'], 'granuleId'),
    sortAndFilter(granuleResults, ['timestamp'], 'granuleId')
  );

  t.deepEqual(
    sortAndFilter(searchResults[3].results, ['timestamp'], 'pdrName'),
    sortAndFilter(pdrResults, ['timestamp'], 'pdrName')
  );

  t.deepEqual(
    sortAndFilter(searchResults[4].results, ['timestamp'], 'id'),
    sortAndFilter(providerResults, ['timestamp'], 'id')
  );

  t.deepEqual(
    sortAndFilter(searchResults[5].results, ['timestamp'], 'name'),
    sortAndFilter(fakeReconciliationReportRecords, ['timestamp'], 'name')
  );
});

test.serial('failure in indexing record of specific type should not prevent indexing of other records with same type', async (t) => {
  const { esAlias, esClient, knex } = t.context;
  const granulePgModel = new GranulePgModel();
  const numItems = 7;
  const collectionRecord = await addFakeData(
    knex,
    1,
    fakeCollectionRecordFactory,
    new CollectionPgModel()
  );
  const fakeData = await addFakeData(knex, numItems, fakeGranuleRecordFactory, granulePgModel, {
    collection_cumulus_id: collectionRecord[0].cumulus_id,
    created_at: new Date(),
    updated_at: new Date(),
  });

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
      knex,
    });

    searchResults = await searchEs('granule', esAlias);

    t.is(searchResults.meta.count, successCount);

    searchResults.results.forEach((result) => {
      const sourceData = fakeData.find((data) => data.granule_id === result.granuleId);
      const expected = {
        collectionId: `${collectionRecord[0].name}___${collectionRecord[0].version}`,
        granuleId: sourceData.granule_id,
        status: sourceData.status,
      };
      const actual = {
        collectionId: result.collectionId,
        granuleId: result.granuleId,
        status: result.status,
      };

      t.deepEqual(expected, actual);
    });
  } finally {
    indexGranuleStub.restore();
    await Promise.all(fakeData.map(
      // eslint-disable-next-line camelcase
      ({ granule_id }) => granulePgModel.delete(knex, { granule_id })
    ));
    await Promise.all(searchResults.results.map(
      (result) =>
        esClient.client.delete({
          index: esAlias,
          type: 'granule',
          id: result.granuleId,
          parent: result.collectionId,
          refresh: true,
        })
    ));
  }
});

test.serial(
  'failure in indexing record of one type should not prevent indexing of other records with different type',
  async (t) => {
    const { esAlias, esClient, knex } = t.context;
    const numItems = 2;
    const collectionRecord = await addFakeData(
      knex,
      1,
      fakeCollectionRecordFactory,
      new CollectionPgModel()
    );
    const [fakeProviderData, fakeGranuleData] = await Promise.all([
      addFakeData(
        knex,
        numItems,
        fakeProviderRecordFactory,
        new ProviderPgModel()
      ),
      addFakeData(
        knex,
        numItems,
        fakeGranuleRecordFactory,
        new GranulePgModel(),
        { collection_cumulus_id: collectionRecord[0].cumulus_id }
      ),
    ]);

    const indexGranuleStub = sinon
      .stub(indexer, 'indexGranule')
      .throws(new Error('error'));

    let searchResults;
    try {
      await indexFromDatabase.handler({
        indexName: esAlias,
        knex,
      });

      searchResults = await searchEs('provider', esAlias);

      t.is(searchResults.meta.count, numItems);

      searchResults.results.forEach((result) => {
        const sourceData = fakeProviderData.find(
          (data) => data.name === result.id
        );
        t.deepEqual(
          { host: result.host, id: result.id, protocol: result.protocol },
          {
            host: sourceData.host,
            id: sourceData.name,
            protocol: sourceData.protocol,
          }
        );
      });
    } finally {
      indexGranuleStub.restore();
      await Promise.all(
        fakeProviderData.map(({ name }) => {
          const pgModel = new ProviderPgModel();
          return pgModel.delete(knex, { name });
        })
      );
      await Promise.all(
        fakeGranuleData.map(
          // eslint-disable-next-line camelcase
          ({ granule_id }) => new GranulePgModel().delete(knex, { granule_id })
        )
      );
      await Promise.all(
        searchResults.results.map((result) =>
          esClient.client.delete({
            index: esAlias,
            type: 'provider',
            id: result.id,
            refresh: true,
          }))
      );
    }
  }
);
