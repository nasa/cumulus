'use strict';

const test = require('ava');
const moment = require('moment');
const flatten = require('lodash/flatten');
const range = require('lodash/range');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const awsServices = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');
const { fakeCollectionFactory } = require('../../lib/testUtils');
const { Search } = require('../../es/search');
const {
  reconciliationReportForCollections,
} = require('../../lambdas/internal-reconciliation-report');

const models = require('../../models');
const indexer = require('../../es/indexer');

let esAlias;
let esIndex;
let esClient;

/**
 * Index collections to ES for testing
 *
 * @param {Array<Object>} collections - list of collection objects
 * @returns {Promise} - Promise of collections indexed
 */
async function storeCollectionsToElasticsearch(collections) {
  await Promise.all(
    collections.map((collection) => indexer.indexCollection(esClient, collection, esAlias))
  );
}

test.beforeEach(async (t) => {
  process.env.CollectionsTable = randomId('collectionTable');
  process.env.GranulesTable = randomId('granulesTable');
  process.env.ReconciliationReportsTable = randomId('reconciliationTable');

  t.context.bucketsToCleanup = [];
  t.context.stackName = randomId('stack');
  t.context.systemBucket = randomId('systembucket');
  process.env.stackName = t.context.stackName;
  process.env.system_bucket = t.context.systemBucket;

  await awsServices.s3().createBucket({ Bucket: t.context.systemBucket }).promise()
    .then(() => t.context.bucketsToCleanup.push(t.context.systemBucket));

  await new models.Collection().createTable();
  await new models.Granule().createTable();
  await new models.ReconciliationReport().createTable();

  esAlias = randomId('esalias');
  esIndex = randomId('esindex');
  process.env.ES_INDEX = esAlias;
  await bootstrapElasticSearch('fakehost', esIndex, esAlias);
  esClient = await Search.es();
});

test.afterEach.always(async (t) => {
  await Promise.all(
    flatten([
      t.context.bucketsToCleanup.map(recursivelyDeleteS3Bucket),
      new models.Collection().deleteTable(),
      new models.Granule().deleteTable(),
      new models.ReconciliationReport().deleteTable(),
    ])
  );
  await esClient.indices.delete({ index: esIndex });
});

test.serial('reconciliationReportForCollections reports discrepancy of collection holdings in ES and DB', async (t) => {
  const searchParams = {
    startTimestamp: moment.utc().format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };
  const matchingColls = range(10).map(() => fakeCollectionFactory());
  const extraDbColls = range(2).map(() => fakeCollectionFactory());
  const extraEsColls = range(2).map(() => fakeCollectionFactory());

  const conflictCollInDb = fakeCollectionFactory({ meta: { flag: 'db' } });
  const conflictCollInEs = { ...conflictCollInDb, meta: { flag: 'es' } };

  await storeCollectionsToElasticsearch(
    matchingColls.concat(extraEsColls).concat(conflictCollInEs)
  );

  await new models.Collection().create(matchingColls.concat(extraDbColls).concat(conflictCollInDb));

  let collectionReport = await reconciliationReportForCollections(searchParams);

  t.is(collectionReport.okCount, 10);
  t.is(collectionReport.onlyInEs.length, 2);
  t.is(collectionReport.onlyInDb.length, 2);
  t.is(collectionReport.conflicts.length, 1);

  //TODO verify content of the report

  const paramsTimeOutOfRange = {
    startTimestamp: moment.utc().add(1, 'hour').format(),
    endTimestamp: moment.utc().add(2, 'hour').format(),
  };

  collectionReport = await reconciliationReportForCollections(paramsTimeOutOfRange);
  t.is(collectionReport.okCount, 0);
  t.is(collectionReport.onlyInEs.length, 0);
  t.is(collectionReport.onlyInDb.length, 0);
  t.is(collectionReport.conflicts.length, 0);

  const paramsCollectionId = {
    ...searchParams,
    collectionId: constructCollectionId(conflictCollInDb.name, conflictCollInDb.version),
  };

  collectionReport = await reconciliationReportForCollections(paramsCollectionId);
  t.is(collectionReport.okCount, 0);
  t.is(collectionReport.onlyInEs.length, 0);
  t.is(collectionReport.onlyInDb.length, 0);
  t.is(collectionReport.conflicts.length, 1);
});
