'use strict';

const test = require('ava');
const moment = require('moment');
const flatten = require('lodash/flatten');
const range = require('lodash/range');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const awsServices = require('@cumulus/aws-client/services');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');
const { fakeCollectionFactory, fakeGranuleFactoryV2 } = require('../../lib/testUtils');
const { Search } = require('../../es/search');
const {
  reconciliationReportForCollections,
  reconciliationReportForGranules,
} = require('../../lambdas/internal-reconciliation-report');

const models = require('../../models');
const indexer = require('../../es/indexer');
const { deconstructCollectionId } = require('../../lib/utils');

let esAlias;
let esIndex;
let esClient;

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
  const matchingColls = range(10).map(() => fakeCollectionFactory());
  const extraDbColls = range(2).map(() => fakeCollectionFactory());
  const extraEsColls = range(2).map(() => fakeCollectionFactory());

  const conflictCollInDb = fakeCollectionFactory({ meta: { flag: 'db' } });
  const conflictCollInEs = { ...conflictCollInDb, meta: { flag: 'es' } };

  const esCollections = matchingColls.concat(extraEsColls, conflictCollInEs);
  const dbCollections = matchingColls.concat(extraDbColls, conflictCollInDb);

  await Promise.all(
    esCollections.map((collection) => indexer.indexCollection(esClient, collection, esAlias))
  );
  await new models.Collection().create(dbCollections);

  let report = await reconciliationReportForCollections({});

  t.is(report.okCount, 10);
  t.is(report.onlyInEs.length, 2);
  t.deepEqual(report.onlyInEs.sort(),
    extraEsColls.map((coll) => constructCollectionId(coll.name, coll.version)).sort());
  t.is(report.onlyInDb.length, 2);
  t.deepEqual(report.onlyInDb.sort(),
    extraDbColls.map((coll) => constructCollectionId(coll.name, coll.version)).sort());
  t.is(report.withConflicts.length, 1);
  t.deepEqual(report.withConflicts[0].es.collectionId, conflictCollInEs.collectionId);
  t.deepEqual(report.withConflicts[0].db.collectionId, conflictCollInDb.collectionId);

  // start/end time include all the collections
  const searchParams = {
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };
  report = await reconciliationReportForCollections(searchParams);
  t.is(report.okCount, 10);
  t.is(report.onlyInEs.length, 2);
  t.is(report.onlyInDb.length, 2);
  t.is(report.withConflicts.length, 1);

  // start/end time has no matching collections
  const paramsTimeOutOfRange = {
    startTimestamp: moment.utc().add(1, 'hour').format(),
    endTimestamp: moment.utc().add(2, 'hour').format(),
  };

  report = await reconciliationReportForCollections(paramsTimeOutOfRange);
  t.is(report.okCount, 0);
  t.is(report.onlyInEs.length, 0);
  t.is(report.onlyInDb.length, 0);
  t.is(report.withConflicts.length, 0);

  // collectionId matches the collection with conflicts
  const collectionId = constructCollectionId(conflictCollInDb.name, conflictCollInDb.version);
  const paramsCollectionId = { ...searchParams, collectionId };

  report = await reconciliationReportForCollections(paramsCollectionId);
  t.is(report.okCount, 0);
  t.is(report.onlyInEs.length, 0);
  t.is(report.onlyInDb.length, 0);
  t.is(report.withConflicts.length, 1);
});

test.serial('reconciliationReportForGranules reports discrepancy of granule holdings in ES and DB', async (t) => {
  const collectionId = constructCollectionId(randomString(), randomString());
  const provider = randomString();

  const matchingGrans = range(10).map(() => fakeGranuleFactoryV2({ collectionId, provider }));
  const additionalMatchingGranus = range(10).map(() => fakeGranuleFactoryV2({ provider }));
  const extraDbGrans = range(2).map(() => fakeGranuleFactoryV2({ collectionId, provider }));
  const additionalExtraDbGrans = range(2).map(() => fakeGranuleFactoryV2());
  const extraEsGrans = range(2).map(() => fakeGranuleFactoryV2({ provider }));
  const additionalExtraEsGrans = range(2)
    .map(() => fakeGranuleFactoryV2({ collectionId, provider }));
  const conflictGranInDb = fakeGranuleFactoryV2({ collectionId });
  const conflictGranInEs = { ...conflictGranInDb, status: 'failed' };

  const esGranules = matchingGrans
    .concat(additionalMatchingGranus, extraEsGrans, additionalExtraEsGrans, conflictGranInEs);
  const dbGranules = matchingGrans
    .concat(additionalMatchingGranus, extraDbGrans, additionalExtraDbGrans, conflictGranInDb);

  // add granules and related collections to es and db
  await Promise.all(
    esGranules.map(async (gran) => {
      await indexer.indexGranule(esClient, gran, esAlias);
      const collection = fakeCollectionFactory({ ...deconstructCollectionId(gran.collectionId) });
      await indexer.indexCollection(esClient, collection, esAlias);
      await new models.Collection().create(collection);
    })
  );

  await new models.Granule().create(dbGranules);

  let report = await reconciliationReportForGranules({});
  t.is(report.okCount, 20);
  t.is(report.onlyInEs.length, 4);
  t.deepEqual(report.onlyInEs.map((gran) => gran.granuleId).sort(),
    extraEsGrans.concat(additionalExtraEsGrans).map((gran) => gran.granuleId).sort());
  t.is(report.onlyInDb.length, 4);
  t.deepEqual(report.onlyInDb.map((gran) => gran.granuleId).sort(),
    extraDbGrans.concat(additionalExtraDbGrans).map((gran) => gran.granuleId).sort());
  t.is(report.withConflicts.length, 1);
  t.deepEqual(report.withConflicts[0].es.granuleId, conflictGranInEs.granuleId);
  t.deepEqual(report.withConflicts[0].db.granuleId, conflictGranInDb.granuleId);

  // start/end time include all the granules
  const searchParams = {
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };
  report = await reconciliationReportForGranules(searchParams);
  t.is(report.okCount, 20);
  t.is(report.onlyInEs.length, 4);
  t.is(report.onlyInDb.length, 4);
  t.is(report.withConflicts.length, 1);

  // start/end time has no matching collections
  const outOfRangeParams = {
    startTimestamp: moment.utc().add(1, 'hour').format(),
    endTimestamp: moment.utc().add(2, 'hour').format(),
  };

  report = await reconciliationReportForGranules(outOfRangeParams);
  t.is(report.okCount, 0);
  t.is(report.onlyInEs.length, 0);
  t.is(report.onlyInDb.length, 0);
  t.is(report.withConflicts.length, 0);

  // collectionId, provider parameters
  const collectionProviderParams = { ...searchParams, collectionId, provider };
  report = await reconciliationReportForGranules(collectionProviderParams);
  t.is(report.okCount, 10);
  t.is(report.onlyInEs.length, 2);
  t.deepEqual(report.onlyInEs.map((gran) => gran.granuleId).sort(),
    additionalExtraEsGrans.map((gran) => gran.granuleId).sort());
  t.is(report.onlyInDb.length, 2);
  t.deepEqual(report.onlyInDb.map((gran) => gran.granuleId).sort(),
    extraDbGrans.map((gran) => gran.granuleId).sort());
  t.is(report.withConflicts.length, 0);

  // provider parameter
  const providerParams = { ...searchParams, provider };
  report = await reconciliationReportForGranules(providerParams);
  t.is(report.okCount, 20);
  t.is(report.onlyInEs.length, 4);
  t.deepEqual(report.onlyInEs.map((gran) => gran.granuleId).sort(),
    extraEsGrans.concat(additionalExtraEsGrans).map((gran) => gran.granuleId).sort());
  t.is(report.onlyInDb.length, 2);
  t.deepEqual(report.onlyInDb.map((gran) => gran.granuleId).sort(),
    extraDbGrans.map((gran) => gran.granuleId).sort());
  t.is(report.withConflicts.length, 0);

  // granuleId parameter
  const granuleId = conflictGranInDb.granuleId;
  const granuleIdParams = { granuleId };
  report = await reconciliationReportForGranules(granuleIdParams);
  t.is(report.okCount, 0);
  t.is(report.onlyInEs.length, 0);
  t.is(report.onlyInDb.length, 0);
  t.is(report.withConflicts.length, 1);
});
