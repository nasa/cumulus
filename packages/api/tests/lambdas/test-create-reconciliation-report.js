'use strict';

const cryptoRandomString = require('crypto-random-string');
const flatten = require('lodash/flatten');
const map = require('lodash/map');
const moment = require('moment');
const pMap = require('p-map');
const omit = require('lodash/omit');
const range = require('lodash/range');
const sample = require('lodash/sample');
const sinon = require('sinon');
const sortBy = require('lodash/sortBy');
const test = require('ava');
const { CMR } = require('@cumulus/cmr-client');
const { ESSearchQueue } = require('@cumulus/es-client/esSearchQueue');
const {
  buildS3Uri,
  parseS3Uri,
  recursivelyDeleteS3Bucket,
  getJsonS3Object,
  getObjectStreamContents,
} = require('@cumulus/aws-client/S3');
const awsServices = require('@cumulus/aws-client/services');
const BucketsConfig = require('@cumulus/common/BucketsConfig');
const { getBucketsConfigKey } = require('@cumulus/common/stack');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  generateLocalTestDb,
  localStackConnectionEnv,
  FilePgModel,
  GranulePgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  migrationDir,
  translateApiGranuleToPostgresGranule,
  translatePostgresCollectionToApiCollection,
  ExecutionPgModel,
  fakeExecutionRecordFactory,
  upsertGranuleWithExecutionJoinRecord,
} = require('@cumulus/db');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');

const {
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
  fakeOrcaGranuleFactory,
} = require('../../lib/testUtils');
const {
  handler: unwrappedHandler, reconciliationReportForGranules, reconciliationReportForGranuleFiles,
} = require('../../lambdas/create-reconciliation-report');
const models = require('../../models');
const { normalizeEvent } = require('../../lib/reconciliationReport/normalizeEvent');
const ORCASearchCatalogQueue = require('../../lib/ORCASearchCatalogQueue');

// Call normalize event on all input events before calling the handler.
const handler = (event) => unwrappedHandler(normalizeEvent(event));

let esAlias;
let esIndex;
let esClient;

const createBucket = (Bucket) => awsServices.s3().createBucket({ Bucket });
const testDbName = `create_rec_reports_${cryptoRandomString({ length: 10 })}`;

function createDistributionBucketMapFromBuckets(buckets) {
  let bucketMap = {};
  Object.keys(buckets).forEach((key) => {
    bucketMap = {
      ...bucketMap, ...{ [buckets[key].name]: buckets[key].name },
    };
  });
  return bucketMap;
}

function createDistributionBucketMap(bucketList) {
  const distributionMap = {};
  bucketList.forEach((bucket) => {
    distributionMap[bucket] = bucket;
  });
  return distributionMap;
}

async function storeBucketsConfigToS3(buckets, systemBucket, stackName) {
  const bucketsConfig = {};
  buckets.forEach((bucket) => {
    bucketsConfig[bucket] = {
      name: bucket,
      type: 'protected',
    };
  });

  const distributionMap = createDistributionBucketMap(buckets);

  await awsServices.s3().putObject({
    Bucket: systemBucket,
    Key: getDistributionBucketMapKey(stackName),
    Body: JSON.stringify(distributionMap),
  });

  return await awsServices.s3().putObject({
    Bucket: systemBucket,
    Key: getBucketsConfigKey(stackName),
    Body: JSON.stringify(bucketsConfig),
  });
}

// Expect files to have bucket and key properties
async function storeFilesToS3(files) {
  const putObjectParams = files.map((file) => ({
    Bucket: file.bucket,
    Key: file.key,
    Body: randomId('Body'),
  }));

  return await pMap(
    putObjectParams,
    async (params) => await awsServices.s3().putObject(params),
    { concurrency: 10 }
  );
}

/**
 * Index a single collection to elasticsearch. If the collection object has an
 * updatedAt value, use a sinon stub to set the time of the granule to that
 * input time.
 * @param {Object} collection  - a collection object
*  @returns {Promise} - promise of indexed collection with active granule
*/
async function storeCollection(collection) {
  let stub;
  if (collection.updatedAt) {
    stub = sinon.stub(Date, 'now').returns(collection.updatedAt);
  }
  try {
    await indexer.indexCollection(esClient, collection, esAlias);
    return indexer.indexGranule(
      esClient,
      fakeGranuleFactoryV2({
        collectionId: constructCollectionId(collection.name, collection.version),
        updatedAt: collection.updatedAt,
        provider: randomString(),
      }),
      esAlias
    );
  } finally {
    if (collection.updatedAt) stub.restore();
  }
}

/**
 * Index Dated collections to ES for testing timeranges.  These need to happen
 * in sequence because of the way we are stubbing Date.now() during indexing.
 *
 * @param {Array<Object>} collections - list of collection objects
 * @returns {Promise} - Promise of collections indexed
 */
function storeCollectionsToElasticsearch(collections) {
  let result = Promise.resolve();
  collections.forEach((collection) => {
    result = result.then(() => storeCollection(collection));
  });
  return result;
}

/**
 * Index granules to ES for testing
 *
 * @param {Array<Object>} granules - list of granules objects
 * @returns {Promise} - Promise of indexed granules
 */
async function storeGranulesToElasticsearch(granules) {
  await Promise.all(
    granules.map((granule) => indexer.indexGranule(esClient, granule, esAlias))
  );
}

async function fetchCompletedReport(reportRecord) {
  const { Bucket, Key } = parseS3Uri(reportRecord.location);
  return await getJsonS3Object(Bucket, Key);
}

async function fetchCompletedReportString(reportRecord) {
  return await awsServices.s3()
    .getObject(parseS3Uri(reportRecord.location))
    .then((response) => getObjectStreamContents(response.Body));
}

/**
 * Looks up and returns the granulesIds given a list of collectionIds.
 * @param {Array<string>} collectionIds - list of collectionIds
 * @returns {Array<string>} list of matching granuleIds
 */
async function granuleIdsFromCollectionIds(collectionIds) {
  const esValues = await (new Search(
    { queryStringParameters: { collectionId__in: collectionIds.join(',') } },
    'granule',
    esAlias
  )).query();
  return esValues.results.map((value) => value.granuleId);
}

/**
 * Looks up and returns the providers given a list of collectionIds.
 * @param {Array<string>} collectionIds - list of collectionIds
 * @returns {Array<string>} list of matching providers
 */
async function providersFromCollectionIds(collectionIds) {
  const esValues = await (new Search(
    { queryStringParameters: { collectionId__in: collectionIds.join(',') } },
    'granule',
    esAlias
  )).query();

  return esValues.results.map((value) => value.provider);
}

const randomBetween = (a, b) => Math.floor(Math.random() * (b - a + 1) + a);
const randomTimeBetween = (t1, t2) => randomBetween(t1, t2);

/**
 * Prepares localstack with a number of active granules.  Sets up ES with
 * random collections where some fall within the start and end timestamps.
 * Also creates a number that are only in ES, as well as some that are only
 * "returned by CMR" (as a stubbed function)
 * @param {Object} t - AVA test context.
 * @returns {Object} setupVars - Object with information about the current
 * state of elasticsearch and CMR mock.
 * The object returned has:
 *  + startTimestamp - beginning of matching timerange
 *  + endTimestamp - end of matching timerange
 *  + matchingCollections - active collections dated between the start and end
 *      timestamps and included in the CMR mock
 *  + matchingCollectionsOutsiderange - active collections dated not between the
 *      start and end timestamps and included in the CMR mock
 *  + extraESCollections - collections within the timestamp range, but excluded
 *      from CMR mock. (only in ES)
 *  + extraESCollectionsOutOfRange - collections outside the timestamp range and
 *      excluded from CMR mock. (only in ES out of range)
 *  + extraCmrCollections - collections not in ES but returned by the CMR mock.
 */
const setupElasticAndCMRForTests = async ({ t, params = {} }) => {
  const dataBuckets = range(2).map(() => randomId('bucket'));
  await Promise.all(
    dataBuckets.map((bucket) =>
      createBucket(bucket)
        .then(() => t.context.bucketsToCleanup.push(bucket)))
  );
  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Default values for input params.
  const {
    numMatchingCollections = randomBetween(10, 15),
    numMatchingCollectionsOutOfRange = randomBetween(5, 10),
    numExtraESCollections = randomBetween(5, 10),
    numExtraESCollectionsOutOfRange = randomBetween(5, 10),
    numExtraCmrCollections = randomBetween(5, 10),
  } = params;

  const startTimestamp = new Date('2020-06-01T00:00:00.000Z').getTime();
  const monthEarlier = moment(startTimestamp).subtract(1, 'month').valueOf();
  const endTimestamp = new Date('2020-07-01T00:00:00.000Z').getTime();
  const monthLater = moment(endTimestamp).add(1, 'month').valueOf();

  // Create collections that are in sync ES/CMR during the time period
  const matchingCollections = range(numMatchingCollections).map((r) => ({
    name: randomId(`name${r}-`),
    version: randomId('vers'),
    updatedAt: randomTimeBetween(startTimestamp, endTimestamp),
  }));
  // Create collections in sync ES/CMR outside of the timestamps range
  const matchingCollectionsOutsideRange = range(numMatchingCollectionsOutOfRange).map((r) => ({
    name: randomId(`name${r}-`),
    version: randomId('vers'),
    updatedAt: randomTimeBetween(monthEarlier, startTimestamp - 1),
  }));
  // Create collections in ES only within the timestamp range
  const extraESCollections = range(numExtraESCollections).map((r) => ({
    name: randomId(`extraES${r}-`),
    version: randomId('vers'),
    updatedAt: randomTimeBetween(startTimestamp, endTimestamp),
  }));
  // Create collections in ES only outside of the timestamp range
  const extraESCollectionsOutOfRange = range(numExtraESCollectionsOutOfRange).map((r) => ({
    name: randomId(`extraES${r}-`),
    version: randomId('vers'),
    updatedAt: randomTimeBetween(endTimestamp + 1, monthLater),
  }));
  // create extra cmr collections that fall inside of the range.
  const extraCmrCollections = range(numExtraCmrCollections).map((r) => ({
    name: randomId(`extraCmr${r}-`),
    version: randomId('vers'),
    updatedAt: randomTimeBetween(startTimestamp, endTimestamp),
  }));

  const cmrCollections = sortBy(
    matchingCollections
      .concat(matchingCollectionsOutsideRange)
      .concat(extraCmrCollections),
    ['name', 'version']
  ).map((collection) => ({
    umm: { ShortName: collection.name, Version: collection.version },
  }));

  // Stub CMR searchConcept that filters on inputParams if present.
  CMR.prototype.searchConcept.restore();
  const cmrSearchStub = sinon.stub(CMR.prototype, 'searchConcept');
  cmrSearchStub.withArgs('collections').onCall(0).resolves(cmrCollections);
  cmrSearchStub.withArgs('collections').onCall(1).resolves([]);
  cmrSearchStub.withArgs('granules').resolves([]);

  await storeCollectionsToElasticsearch(
    matchingCollections
      .concat(matchingCollectionsOutsideRange)
      .concat(extraESCollections)
      .concat(extraESCollectionsOutOfRange)
  );

  return {
    startTimestamp,
    endTimestamp,
    matchingCollections,
    matchingCollectionsOutsideRange,
    extraESCollections,
    extraESCollectionsOutOfRange,
    extraCmrCollections,
  };
};

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };
  process.env.cmr_password_secret_name = randomId('cmr-secret-name');
  await awsServices.secretsManager().createSecret({
    Name: process.env.cmr_password_secret_name,
    SecretString: randomId('cmr-password'),
  }).promise();
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.filePgModel = new FilePgModel();
  t.context.granulePgModel = new GranulePgModel();
});

test.beforeEach(async (t) => {
  process.env.ReconciliationReportsTable = randomId('reconciliationTable');

  t.context.bucketsToCleanup = [];
  t.context.stackName = randomId('stack');
  t.context.systemBucket = randomId('bucket');
  process.env.system_bucket = t.context.systemBucket;

  await awsServices.s3().createBucket({ Bucket: t.context.systemBucket })
    .then(() => t.context.bucketsToCleanup.push(t.context.systemBucket));

  await new models.ReconciliationReport().createTable();

  const cmrSearchStub = sinon.stub(CMR.prototype, 'searchConcept');
  cmrSearchStub.withArgs('collections').resolves([]);
  cmrSearchStub.withArgs('granules').resolves([]);

  esAlias = randomId('esalias');
  esIndex = randomId('esindex');
  process.env.ES_INDEX = esAlias;
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: esAlias,
  });
  esClient = await Search.es();

  t.context.execution = fakeExecutionRecordFactory();
  const [pgExecution] = await t.context.executionPgModel.create(
    t.context.knex,
    t.context.execution
  );
  t.context.executionCumulusId = pgExecution.cumulus_id;
});

test.afterEach.always(async (t) => {
  await Promise.all(
    flatten([
      t.context.bucketsToCleanup.map(recursivelyDeleteS3Bucket),
      new models.ReconciliationReport().deleteTable(),
    ])
  );
  await t.context.executionPgModel.delete(
    t.context.knex,
    { cumulus_id: t.context.executionCumulusId }
  );
  CMR.prototype.searchConcept.restore();
  await esClient.indices.delete({ index: esIndex });
});

test.after.always(async (t) => {
  await awsServices.secretsManager().deleteSecret({
    SecretId: process.env.cmr_password_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  delete process.env.cmr_password_secret_name;
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.serial('Generates valid reconciliation report for no buckets', async (t) => {
  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    [],
    t.context.systemBucket,
    t.context.stackName
  );

  const startTimestamp = new Date(1970, 0, 1);
  const endTimestamp = moment().add(1, 'hour');

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    startTimestamp,
    endTimestamp,
  };

  const reportRecord = await handler(event, {});

  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, 0);
  t.is(filesInCumulus.onlyInS3.length, 0);
  t.is(filesInCumulus.onlyInDb.length, 0);

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
  t.is(report.reportStartTime, (new Date(startTimestamp)).toISOString());
  t.is(report.reportEndTime, (new Date(endTimestamp)).toISOString());
});

test.serial('Generates valid GNF reconciliation report when everything is in sync', async (t) => {
  const { filePgModel, granulePgModel, knex } = t.context;

  const dataBuckets = range(2).map(() => randomId('bucket'));
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create collections that are in sync
  const matchingColls = range(10).map(() => ({
    name: randomId('name'),
    version: randomId('vers'),
  }));
  await storeCollectionsToElasticsearch(matchingColls);

  const collection = fakeCollectionRecordFactory({
    name: matchingColls[0].name,
    version: matchingColls[0].version,
  });
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    collection
  );
  const collectionCumulusId = pgCollection.cumulus_id;

  // Create random files
  const pgGranules = await granulePgModel.insert(
    knex,
    range(10).map(() => fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
    }))
  );
  const files = range(10).map((i) => ({
    bucket: dataBuckets[i % dataBuckets.length],
    key: randomId('key'),
    granule_cumulus_id: pgGranules[i].cumulus_id,
  }));

  // Store the files to S3 and DynamoDB
  await Promise.all([
    storeFilesToS3(files),
    filePgModel.insert(knex, files),
  ]);

  const cmrCollections = sortBy(matchingColls, ['name', 'version'])
    .map((cmrCollection) => ({
      umm: { ShortName: cmrCollection.name, Version: cmrCollection.version },
    }));

  CMR.prototype.searchConcept.restore();
  const cmrSearchStub = sinon.stub(CMR.prototype, 'searchConcept');
  cmrSearchStub.withArgs('collections').onCall(0).resolves(cmrCollections);
  cmrSearchStub.withArgs('collections').onCall(1).resolves([]);
  cmrSearchStub.withArgs('granules').resolves([]);

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Granule Not Found',
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
  t.is(report.status, 'SUCCESS');

  const granuleIds = Object.keys(filesInCumulus.okCountByGranule);
  granuleIds.forEach((granuleId) => {
    const okCountForGranule = filesInCumulus.okCountByGranule[granuleId];
    t.is(okCountForGranule, 1);
  });

  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, files.length);
  t.is(filesInCumulus.onlyInS3.length, 0);
  t.is(filesInCumulus.onlyInDb.length, 0);
  t.is(collectionsInCumulusCmr.okCount, matchingColls.length);
  t.is(collectionsInCumulusCmr.onlyInCumulus.length, 0);
  t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial('Generates a valid Inventory reconciliation report when everything is in sync', async (t) => {
  const { filePgModel, granulePgModel, knex } = t.context;

  const dataBuckets = range(2).map(() => randomId('bucket'));
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create collections that are in sync
  const matchingColls = range(10).map(() => ({
    name: randomId('name'),
    version: randomId('vers'),
  }));
  await storeCollectionsToElasticsearch(matchingColls);

  const collection = fakeCollectionRecordFactory({
    name: matchingColls[0].name,
    version: matchingColls[0].version,
  });
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    collection
  );
  const collectionCumulusId = pgCollection.cumulus_id;

  // Create random files
  const pgGranules = await granulePgModel.insert(
    knex,
    range(10).map(() => fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
    }))
  );
  const files = range(10).map((i) => ({
    bucket: dataBuckets[i % dataBuckets.length],
    key: randomId('key'),
    granule_cumulus_id: pgGranules[i].cumulus_id,
  }));

  // Store the files to S3 and DynamoDB
  await Promise.all([
    storeFilesToS3(files),
    filePgModel.insert(knex, files),
  ]);

  const cmrCollections = sortBy(matchingColls, ['name', 'version'])
    .map((cmrCollection) => ({
      umm: { ShortName: cmrCollection.name, Version: cmrCollection.version },
    }));

  CMR.prototype.searchConcept.restore();
  const cmrSearchStub = sinon.stub(CMR.prototype, 'searchConcept');
  cmrSearchStub.withArgs('collections').onCall(0).resolves(cmrCollections);
  cmrSearchStub.withArgs('collections').onCall(1).resolves([]);
  cmrSearchStub.withArgs('granules').resolves([]);

  await storeCollectionsToElasticsearch(matchingColls);

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Inventory',
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
  t.is(report.status, 'SUCCESS');

  t.is(filesInCumulus.okCountByGranule, undefined);

  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, files.length);
  t.is(filesInCumulus.onlyInS3.length, 0);
  t.is(filesInCumulus.onlyInDb.length, 0);
  t.is(collectionsInCumulusCmr.okCount, matchingColls.length);
  t.is(collectionsInCumulusCmr.onlyInCumulus.length, 0);
  t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial('Generates valid reconciliation report when there are extra internal S3 objects', async (t) => {
  const { filePgModel, granulePgModel, knex } = t.context;

  const collection = fakeCollectionRecordFactory();
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    collection
  );
  const collectionCumulusId = pgCollection.cumulus_id;

  const dataBuckets = range(2).map(() => randomId('bucket'));
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create files that are in sync
  const pgGranules = await granulePgModel.insert(
    knex,
    range(10).map(() => fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
    }))
  );
  const matchingFiles = range(10).map((i) => ({
    bucket: sample(dataBuckets),
    key: randomId('key'),
    granule_cumulus_id: pgGranules[i].cumulus_id,
  }));

  const extraS3File1 = { bucket: sample(dataBuckets), key: randomId('key') };
  const extraS3File2 = { bucket: sample(dataBuckets), key: randomId('key') };

  // Store the files to S3 and Elasticsearch
  await storeFilesToS3(matchingFiles.concat([extraS3File1, extraS3File2]));
  await filePgModel.insert(knex, matchingFiles);

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Granule Not Found',
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, matchingFiles.length);

  const granuleIds = Object.keys(filesInCumulus.okCountByGranule);
  granuleIds.forEach((granuleId) => {
    const okCountForGranule = filesInCumulus.okCountByGranule[granuleId];
    t.is(okCountForGranule, 1);
  });

  t.is(filesInCumulus.onlyInS3.length, 2);
  t.true(filesInCumulus.onlyInS3.includes(buildS3Uri(extraS3File1.bucket, extraS3File1.key)));
  t.true(filesInCumulus.onlyInS3.includes(buildS3Uri(extraS3File2.bucket, extraS3File2.key)));

  t.is(filesInCumulus.onlyInDb.length, 0);

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial('Generates valid reconciliation report when there are extra internal DynamoDB objects', async (t) => {
  const { filePgModel, granulePgModel, knex } = t.context;

  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  const collection = fakeCollectionRecordFactory();
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    collection
  );
  const collectionCumulusId = pgCollection.cumulus_id;

  // Create files that are in sync
  const granules = range(12).map(() => fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  }));
  const pgGranules = await granulePgModel.insert(
    knex,
    granules
  );
  const matchingFiles = range(10).map((i) => ({
    bucket: sample(dataBuckets),
    key: randomId('key'),
    granule_cumulus_id: pgGranules[i].cumulus_id,
  }));

  const extraDbFile1 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granule_cumulus_id: pgGranules[10].cumulus_id,
    granule_id: granules[10].granule_id,
  };
  const extraDbFile2 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granule_cumulus_id: pgGranules[11].cumulus_id,
    granule_id: granules[11].granule_id,
  };

  // Store the files to S3 and DynamoDB
  await storeFilesToS3(matchingFiles);
  await filePgModel.insert(knex, matchingFiles.concat([
    omit(extraDbFile1, 'granule_id'),
    omit(extraDbFile2, 'granule_id'),
  ]));

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Granule Not Found',
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, matchingFiles.length);
  t.is(filesInCumulus.onlyInS3.length, 0);

  const totalOkCount = Object.values(filesInCumulus.okCountByGranule).reduce(
    (total, currentOkCount) => total + currentOkCount
  );
  t.is(totalOkCount, filesInCumulus.okCount);

  t.is(filesInCumulus.onlyInDb.length, 2);
  t.truthy(filesInCumulus.onlyInDb.find((f) =>
    f.uri === buildS3Uri(extraDbFile1.bucket, extraDbFile1.key)
    && f.granuleId === extraDbFile1.granule_id));
  t.truthy(filesInCumulus.onlyInDb.find((f) =>
    f.uri === buildS3Uri(extraDbFile2.bucket, extraDbFile2.key)
    && f.granuleId === extraDbFile2.granule_id));

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial('Generates valid reconciliation report when internally, there are both extra DynamoDB and extra S3 files', async (t) => {
  const { filePgModel, granulePgModel, knex } = t.context;

  const collection = fakeCollectionRecordFactory();
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    collection
  );
  const collectionCumulusId = pgCollection.cumulus_id;

  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create files that are in sync
  const granules = range(12).map(() => fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  }));
  const pgGranules = await granulePgModel.insert(
    knex,
    granules
  );
  const matchingFiles = range(10).map((i) => ({
    bucket: sample(dataBuckets),
    key: randomId('key'),
    granule_cumulus_id: pgGranules[i].cumulus_id,
  }));

  const extraS3File1 = { bucket: sample(dataBuckets), key: randomString() };
  const extraS3File2 = { bucket: sample(dataBuckets), key: randomString() };

  const extraDbFile1 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granule_cumulus_id: pgGranules[10].cumulus_id,
    granule_id: granules[10].granule_id,
  };
  const extraDbFile2 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granule_cumulus_id: pgGranules[11].cumulus_id,
    granule_id: granules[11].granule_id,
  };

  // Store the files to S3 and DynamoDB
  await storeFilesToS3(matchingFiles.concat([extraS3File1, extraS3File2]));
  await filePgModel.insert(knex, matchingFiles.concat([
    omit(extraDbFile1, 'granule_id'),
    omit(extraDbFile2, 'granule_id'),
  ]));

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Granule Not Found',
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, matchingFiles.length);

  const totalOkCount = Object.values(filesInCumulus.okCountByGranule).reduce(
    (total, currentOkCount) => total + currentOkCount
  );
  t.is(totalOkCount, filesInCumulus.okCount);

  t.is(filesInCumulus.onlyInS3.length, 2);
  t.true(filesInCumulus.onlyInS3.includes(buildS3Uri(extraS3File1.bucket, extraS3File1.key)));
  t.true(filesInCumulus.onlyInS3.includes(buildS3Uri(extraS3File2.bucket, extraS3File2.key)));

  t.is(filesInCumulus.onlyInDb.length, 2);
  t.truthy(filesInCumulus.onlyInDb.find((f) =>
    f.uri === buildS3Uri(extraDbFile1.bucket, extraDbFile1.key)
    && f.granuleId === extraDbFile1.granule_id));
  t.truthy(filesInCumulus.onlyInDb.find((f) =>
    f.uri === buildS3Uri(extraDbFile2.bucket, extraDbFile2.key)
    && f.granuleId === extraDbFile2.granule_id));

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial('Generates valid reconciliation report when there are both extra ES and CMR collections', async (t) => {
  const params = {
    numMatchingCollectionsOutOfRange: 0,
    numExtraESCollectionsOutOfRange: 0,
  };

  const setupVars = await setupElasticAndCMRForTests({ t, params });

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Granule Not Found',
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(collectionsInCumulusCmr.okCount, setupVars.matchingCollections.length);

  t.is(collectionsInCumulusCmr.onlyInCumulus.length, setupVars.extraESCollections.length);
  setupVars.extraESCollections.map((collection) =>
    t.true(collectionsInCumulusCmr.onlyInCumulus
      .includes(constructCollectionId(collection.name, collection.version))));

  t.is(collectionsInCumulusCmr.onlyInCmr.length, setupVars.extraCmrCollections.length);
  setupVars.extraCmrCollections.map((collection) =>
    t.true(collectionsInCumulusCmr.onlyInCmr
      .includes(constructCollectionId(collection.name, collection.version))));

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial(
  'With input time params, generates a valid filtered reconciliation report, when there are extra cumulus/ES and CMR collections',
  async (t) => {
    const { startTimestamp, endTimestamp, ...setupVars } = await setupElasticAndCMRForTests({ t });

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      startTimestamp,
      endTimestamp,
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);
    t.is(collectionsInCumulusCmr.okCount, setupVars.matchingCollections.length);

    t.is(collectionsInCumulusCmr.onlyInCumulus.length, setupVars.extraESCollections.length);
    // Each extra collection in timerange is included
    setupVars.extraESCollections.map((collection) =>
      t.true(collectionsInCumulusCmr.onlyInCumulus
        .includes(constructCollectionId(collection.name, collection.version))));

    // No collections that were out of timestamp are included
    setupVars.extraESCollectionsOutOfRange.map((collection) =>
      t.false(collectionsInCumulusCmr.onlyInCumulus
        .includes(constructCollectionId(collection.name, collection.version))));

    // Timestamps force ONE WAY comparison.
    t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);

    const reportStartTime = report.reportStartTime;
    const reportEndTime = report.reportEndTime;
    t.is(
      (new Date(reportStartTime)).valueOf(),
      startTimestamp
    );
    t.is(
      (new Date(reportEndTime)).valueOf(),
      endTimestamp
    );
  }
);

test.serial(
  'With location param as S3, generates a valid reconciliation report for only S3 and DynamoDB',
  async (t) => {
    const { filePgModel, granulePgModel, knex } = t.context;

    const collection = fakeCollectionRecordFactory();
    const [pgCollection] = await t.context.collectionPgModel.create(
      t.context.knex,
      collection
    );
    const collectionCumulusId = pgCollection.cumulus_id;

    const dataBuckets = range(2).map(() => randomId('bucket'));
    await Promise.all(dataBuckets.map((bucket) =>
      createBucket(bucket)
        .then(() => t.context.bucketsToCleanup.push(bucket))));

    // Write the buckets config to S3
    await storeBucketsConfigToS3(
      dataBuckets,
      t.context.systemBucket,
      t.context.stackName
    );

    // Create random files
    const granules = range(10).map(() => fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
    }));
    const pgGranules = await granulePgModel.insert(
      knex,
      granules
    );
    const files = range(10).map((i) => ({
      bucket: sample(dataBuckets),
      key: randomId('key'),
      granule_cumulus_id: pgGranules[i].cumulus_id,
    }));

    // Store the files to S3 and DynamoDB
    await Promise.all([
      storeFilesToS3(files),
      filePgModel.insert(knex, files),
    ]);

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      reportType: 'Granule Not Found',
      location: 'S3',
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const filesInCumulus = report.filesInCumulus;
    t.is(report.status, 'SUCCESS');

    const granuleIds = Object.keys(filesInCumulus.okCountByGranule);
    granuleIds.forEach((granuleId) => {
      const okCountForGranule = filesInCumulus.okCountByGranule[granuleId];
      t.is(okCountForGranule, 1);
    });

    t.is(report.error, undefined);
    t.is(filesInCumulus.okCount, files.length);
    t.is(filesInCumulus.onlyInS3.length, 0);
    t.is(filesInCumulus.onlyInDb.length, 0);
    t.is(report.collectionsInCumulusCmr.okCount, 0);
    t.is(report.granulesInCumulusCmr.okCount, 0);
    t.is(report.filesInCumulusCmr.okCount, 0);
  }
);

test.serial(
  'With location param as CMR, generates a valid reconciliation report for only Cumulus and CMR',
  async (t) => {
    const params = {
      numMatchingCollectionsOutOfRange: 0,
      numExtraESCollectionsOutOfRange: 0,
    };

    const setupVars = await setupElasticAndCMRForTests({ t, params });

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      location: 'CMR',
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);
    t.is(collectionsInCumulusCmr.okCount, setupVars.matchingCollections.length);
    t.is(report.filesInCumulus.okCount, 0);

    t.is(collectionsInCumulusCmr.onlyInCumulus.length, setupVars.extraESCollections.length);
    setupVars.extraESCollections.map((collection) =>
      t.true(collectionsInCumulusCmr.onlyInCumulus
        .includes(constructCollectionId(collection.name, collection.version))));

    t.is(collectionsInCumulusCmr.onlyInCmr.length, setupVars.extraCmrCollections.length);
    setupVars.extraCmrCollections.map((collection) =>
      t.true(collectionsInCumulusCmr.onlyInCmr
        .includes(constructCollectionId(collection.name, collection.version))));
  }
);

test.serial(
  'Generates valid reconciliation report without time params and there are extra cumulus/ES and CMR collections',
  async (t) => {
    const setupVars = await setupElasticAndCMRForTests({ t });

    const eventNoTimeStamps = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
    };

    const reportRecord = await handler(eventNoTimeStamps);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);

    // ok collections include every matching collection
    t.is(
      collectionsInCumulusCmr.okCount,
      setupVars.matchingCollections.length + setupVars.matchingCollectionsOutsideRange.length
    );

    // all extra ES collections are found
    t.is(
      collectionsInCumulusCmr.onlyInCumulus.length,
      setupVars.extraESCollections.length + setupVars.extraESCollectionsOutOfRange.length
    );
    setupVars.extraESCollections.map((collection) =>
      t.true(collectionsInCumulusCmr.onlyInCumulus
        .includes(constructCollectionId(collection.name, collection.version))));
    setupVars.extraESCollectionsOutOfRange.map((collection) =>
      t.true(collectionsInCumulusCmr.onlyInCumulus
        .includes(constructCollectionId(collection.name, collection.version))));

    // all of the collections only in CMR are found.
    t.is(collectionsInCumulusCmr.onlyInCmr.length, setupVars.extraCmrCollections.length);
    setupVars.extraCmrCollections.map((collection) =>
      t.true(collectionsInCumulusCmr.onlyInCmr
        .includes(constructCollectionId(collection.name, collection.version))));

    t.is(report.reportEndTime, undefined);
    t.is(report.reportStartTime, undefined);
  }
);

test.serial(
  'Generates valid ONE WAY reconciliation report with time params and filters by collectionIds when there are extra cumulus/ES and CMR collections',
  async (t) => {
    const { startTimestamp, endTimestamp, ...setupVars } = await setupElasticAndCMRForTests({ t });

    const testCollection = [
      setupVars.matchingCollections[3],
      setupVars.extraCmrCollections[1],
      setupVars.extraESCollections[1],
      setupVars.extraESCollectionsOutOfRange[0],
    ];
    const collectionId = testCollection.map((c) => constructCollectionId(c.name, c.version));

    console.log(`collectionId: ${JSON.stringify(collectionId)}`);

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      startTimestamp,
      endTimestamp,
      collectionId,
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);
    // Only one collection id is searched.
    t.is(collectionsInCumulusCmr.okCount, 1);

    // cumulus filters by collectionId and only returned the good one above.
    t.is(collectionsInCumulusCmr.onlyInCumulus.length, 1);
    t.true(collectionsInCumulusCmr.onlyInCumulus.includes(collectionId[2]));

    // ONE WAY only comparison because of input timestampes
    t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);

    const reportStartTime = report.reportStartTime;
    const reportEndTime = report.reportEndTime;
    t.is(
      (new Date(reportStartTime)).valueOf(),
      startTimestamp
    );
    t.is(
      (new Date(reportEndTime)).valueOf(),
      endTimestamp
    );
  }
);

test.serial(
  'When a collectionId is in both CMR and Cumulus a valid bi-directional reconciliation report is created.',
  async (t) => {
    const setupVars = await setupElasticAndCMRForTests({ t });

    const testCollection = setupVars.matchingCollections[3];
    console.log(`testCollection: ${JSON.stringify(testCollection)}`);

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      collectionId: [constructCollectionId(testCollection.name, testCollection.version)],
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);
    t.is(collectionsInCumulusCmr.okCount, 1);
    t.is(collectionsInCumulusCmr.onlyInCumulus.length, 0);
    t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);

    t.is(report.reportEndTime, undefined);
    t.is(report.reportStartTime, undefined);
  }
);

test.serial(
  'When an array of collectionId exists only in CMR, creates a valid bi-directional reconciliation report.',
  async (t) => {
    const setupVars = await setupElasticAndCMRForTests({ t });

    const testCollection = [
      setupVars.extraCmrCollections[3],
      setupVars.matchingCollections[2],
      setupVars.extraESCollections[1],
    ];
    const collectionId = testCollection.map((c) => constructCollectionId(c.name, c.version));
    console.log(`testCollection: ${JSON.stringify(collectionId)}`);

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      collectionId,
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);
    // Filtered by collectionId only in cmr
    t.is(collectionsInCumulusCmr.okCount, 1);
    t.is(collectionsInCumulusCmr.onlyInCumulus.length, 1);
    t.true(collectionsInCumulusCmr.onlyInCumulus.includes(collectionId[2]));
    t.is(collectionsInCumulusCmr.onlyInCmr.length, 1);
    t.true(collectionsInCumulusCmr.onlyInCmr.includes(collectionId[0]));

    t.is(report.reportEndTime, undefined);
    t.is(report.reportStartTime, undefined);
  }
);

test.serial(
  'When a filtered collectionId exists only in Cumulus, generates a valid bi-directional reconciliation report.',
  async (t) => {
    const setupVars = await setupElasticAndCMRForTests({ t });

    const testCollection = setupVars.extraESCollections[3];
    console.log(`testCollection: ${JSON.stringify(testCollection)}`);

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      collectionId: constructCollectionId(testCollection.name, testCollection.version),
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);
    t.is(collectionsInCumulusCmr.okCount, 0);
    // Filtered by collectionId
    t.is(collectionsInCumulusCmr.onlyInCumulus.length, 1);
    t.true(collectionsInCumulusCmr.onlyInCumulus.includes(event.collectionId));
    t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);

    const newCreateStartTime = moment(report.createStartTime);
    const newCreateEndTime = moment(report.createEndTime);
    t.true(newCreateStartTime <= newCreateEndTime);

    t.is(report.reportEndTime, undefined);
    t.is(report.reportStartTime, undefined);
  }
);

test.serial(
  'Generates valid ONE WAY reconciliation report with time params and filters by granuleIds when there are extra cumulus/ES and CMR collections',
  async (t) => {
    const { startTimestamp, endTimestamp, ...setupVars } = await setupElasticAndCMRForTests({ t });

    const testCollection = [
      setupVars.matchingCollections[3],
      setupVars.extraCmrCollections[1],
      setupVars.extraESCollections[1],
      setupVars.extraESCollectionsOutOfRange[0],
    ];

    const testCollectionIds = testCollection.map((c) => constructCollectionId(c.name, c.version));
    const testGranuleIds = await granuleIdsFromCollectionIds(testCollectionIds);

    console.log(`granuleIds: ${JSON.stringify(testGranuleIds)}`);

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      startTimestamp,
      endTimestamp,
      granuleId: testGranuleIds,
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);

    t.is(collectionsInCumulusCmr.okCount, 1);

    // cumulus filters collections by granuleId and only returned test one
    t.is(collectionsInCumulusCmr.onlyInCumulus.length, 1);
    t.true(collectionsInCumulusCmr.onlyInCumulus.includes(testCollectionIds[2]));

    // ONE WAY only comparison because of input timestampes
    t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);

    const reportStartTime = report.reportStartTime;
    const reportEndTime = report.reportEndTime;
    t.is(
      (new Date(reportStartTime)).valueOf(),
      startTimestamp
    );
    t.is(
      (new Date(reportEndTime)).valueOf(),
      endTimestamp
    );
  }
);

test.serial(
  'When an array of granuleId exists, creates a valid one-way reconciliation report.',
  async (t) => {
    const setupVars = await setupElasticAndCMRForTests({ t });

    const testCollection = [
      setupVars.extraCmrCollections[3],
      setupVars.matchingCollections[2],
      setupVars.extraESCollections[1],
    ];

    const testCollectionIds = testCollection.map((c) => constructCollectionId(c.name, c.version));
    const testGranuleIds = await granuleIdsFromCollectionIds(testCollectionIds);

    console.log(`testGranuleIds: ${JSON.stringify(testGranuleIds)}`);

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      granuleId: testGranuleIds,
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);

    // Filtered by input granuleIds
    t.is(collectionsInCumulusCmr.okCount, 1);
    t.is(collectionsInCumulusCmr.onlyInCumulus.length, 1);
    t.true(collectionsInCumulusCmr.onlyInCumulus.includes(testCollectionIds[2]));
    // one way
    t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);

    t.is(report.reportEndTime, undefined);
    t.is(report.reportStartTime, undefined);
  }
);

test.serial(
  'When an array of providers exists, creates a valid one-way reconciliation report.',
  async (t) => {
    const setupVars = await setupElasticAndCMRForTests({ t });

    const testCollection = [
      setupVars.extraCmrCollections[3],
      setupVars.matchingCollections[2],
      setupVars.extraESCollections[1],
    ];

    const testCollectionIds = testCollection.map((c) => constructCollectionId(c.name, c.version));
    const testProviders = await providersFromCollectionIds(testCollectionIds);

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      provider: testProviders,
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    const granulesInCumulusCmr = report.granulesInCumulusCmr;

    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);

    // Filtered by input provider
    t.is(collectionsInCumulusCmr.okCount, 1);
    t.is(collectionsInCumulusCmr.onlyInCumulus.length, 1);
    t.true(collectionsInCumulusCmr.onlyInCumulus.includes(testCollectionIds[2]));

    t.is(granulesInCumulusCmr.okCount, 0);
    t.is(granulesInCumulusCmr.onlyInCumulus.length, 1);

    // one way
    t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);
    t.is(granulesInCumulusCmr.onlyInCmr.length, 0);

    t.is(report.reportEndTime, undefined);
    t.is(report.reportStartTime, undefined);
  }
);

test.serial('reconciliationReportForGranules reports discrepancy of granule holdings in CUMULUS and CMR', async (t) => {
  const shortName = randomString();
  const version = randomString();
  const collectionId = constructCollectionId(shortName, version);

  // create granules that are in sync
  const matchingGrans = range(10).map(() =>
    fakeGranuleFactoryV2({ collectionId: collectionId, status: 'completed', files: [] }));

  const extraDbGrans = range(2).map(() =>
    fakeGranuleFactoryV2({ collectionId: collectionId, status: 'completed', files: [] }));

  const extraCmrGrans = range(2).map(() => ({
    granuleId: randomString(),
    collectionId: collectionId,
  }));

  const cmrGranules = sortBy(matchingGrans.concat(extraCmrGrans), ['granuleId']).map((granule) => ({
    umm: {
      GranuleUR: granule.granuleId,
      CollectionReference: { ShortName: shortName, Version: version },
      RelatedUrls: [],
    },
  }));

  CMR.prototype.searchConcept.restore();
  const cmrSearchStub = sinon.stub(CMR.prototype, 'searchConcept');
  cmrSearchStub.withArgs('granules').onCall(0).resolves(cmrGranules);
  cmrSearchStub.withArgs('granules').onCall(1).resolves([]);

  await storeGranulesToElasticsearch(matchingGrans.concat(extraDbGrans));

  const { granulesReport, filesReport } = await reconciliationReportForGranules({
    collectionId,
    bucketsConfig: new BucketsConfig({}),
    distributionBucketMap: {},
    recReportParams: {},
  });

  t.is(granulesReport.okCount, 10);

  const expectedOnlyInCumulus = sortBy(extraDbGrans, ['granuleId']).map((gran) =>
    ({ granuleId: gran.granuleId, collectionId: gran.collectionId }));
  t.deepEqual(granulesReport.onlyInCumulus, expectedOnlyInCumulus);

  t.deepEqual(granulesReport.onlyInCmr.map((gran) => gran.GranuleUR),
    extraCmrGrans.map((gran) => gran.granuleId).sort());

  t.is(filesReport.okCount, 0);
  t.is(filesReport.onlyInCumulus.length, 0);
  t.is(filesReport.onlyInCmr.length, 0);
});

test.serial('reconciliationReportForGranuleFiles reports discrepancy of granule file holdings in CUMULUS and CMR', async (t) => {
  process.env.DISTRIBUTION_ENDPOINT = 'https://example.com/';
  const buckets = {
    internal: { name: 'cumulus-test-sandbox-internal', type: 'internal' },
    private: { name: 'testbucket-private', type: 'private' },
    protected: { name: 'testbucket-protected', type: 'protected' },
    public: { name: 'testbucket-public', type: 'public' },
    'protected-2': { name: 'testbucket-protected-2', type: 'protected' },
  };
  const bucketsConfig = new BucketsConfig(buckets);
  const distributionBucketMap = createDistributionBucketMapFromBuckets(buckets);

  const matchingFilesInDb = [{
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    size: 17865615,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
  },
  {
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
  },
  {
    bucket: 'testbucket-protected-2',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
    size: 2708,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
  }];

  const privateFilesInDb = [{
    bucket: 'testbucket-private',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
  }];

  const filesOnlyInDb = [{
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/extra123.jpg',
    size: 44118,
    fileName: 'extra123.jpg',
  },
  {
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/MOD/extra456.jpg',
    size: 44118,
    fileName: 'extra456.jpg',
  }];

  const granuleInDb = {
    granuleId: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    collectionId: constructCollectionId('MOD09GQ', '006'),
    files: matchingFilesInDb.concat(privateFilesInDb).concat(filesOnlyInDb),
  };

  const matchingFilesInCmr = [{
    URL: `${process.env.DISTRIBUTION_ENDPOINT}testbucket-protected/MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf`,
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: `${process.env.DISTRIBUTION_ENDPOINT}testbucket-public/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg`,
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: `${process.env.DISTRIBUTION_ENDPOINT}testbucket-protected-2/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml`,
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const filesOnlyInCmr = [{
    URL: 'https://enjo7p7os7.execute-api.us-east-1.amazonaws.com/dev/MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const urlsShouldOnlyInCmr = [{
    URL: `${process.env.DISTRIBUTION_ENDPOINT}s3credentials`,
    Type: 'VIEW RELATED INFORMATION',
    Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
  }];

  const granuleInCmr = {
    GranuleUR: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    ShortName: 'MOD09GQ',
    Version: '006',
    RelatedUrls: matchingFilesInCmr.concat(filesOnlyInCmr).concat(urlsShouldOnlyInCmr),
  };
  const report = await reconciliationReportForGranuleFiles({
    granuleInDb,
    granuleInCmr,
    bucketsConfig,
    distributionBucketMap,
  });
  t.is(report.okCount, matchingFilesInDb.length + privateFilesInDb.length);

  t.is(report.onlyInCumulus.length, filesOnlyInDb.length);
  t.deepEqual(map(report.onlyInCumulus, 'fileName').sort(), map(filesOnlyInDb, 'fileName').sort());

  t.is(report.onlyInCmr.length, filesOnlyInCmr.length);
  t.deepEqual(map(report.onlyInCmr, 'URL').sort(), map(filesOnlyInCmr, 'URL').sort());
});

test.serial('reconciliationReportForGranuleFiles reports discrepancy of granule file holdings in CUMULUS and CMR that have S3 links', async (t) => {
  process.env.DISTRIBUTION_ENDPOINT = 'https://example.com/';
  const buckets = {
    internal: { name: 'cumulus-test-sandbox-internal', type: 'internal' },
    private: { name: 'testbucket-private', type: 'private' },
    protected: { name: 'testbucket-protected', type: 'protected' },
    public: { name: 'testbucket-public', type: 'public' },
    'protected-2': { name: 'testbucket-protected-2', type: 'protected' },
  };
  const bucketsConfig = new BucketsConfig(buckets);
  const distributionBucketMap = createDistributionBucketMapFromBuckets(buckets);
  const matchingFilesInDb = [{
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    size: 17865615,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
  },
  {
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
  },
  {
    bucket: 'testbucket-protected-2',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
    size: 2708,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
  }];

  const privateFilesInDb = [{
    bucket: 'testbucket-private',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
  }];

  const filesOnlyInDb = [{
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/extra123.jpg',
    size: 44118,
    fileName: 'extra123.jpg',
  },
  {
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/MOD/extra456.jpg',
    size: 44118,
    fileName: 'extra456.jpg',
  }];

  const granuleInDb = {
    granuleId: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    collectionId: constructCollectionId('MOD09GQ', '006'),
    files: matchingFilesInDb.concat(privateFilesInDb).concat(filesOnlyInDb),
  };

  const matchingFilesInCmr = [{
    URL: 's3://testbucket-protected/MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: 's3://testbucket-public/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: `${process.env.DISTRIBUTION_ENDPOINT}testbucket-protected-2/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml`,
    Type: 'EXTENDED METADATA',
    Description: 'File to download',
  }];

  const filesOnlyInCmr = [{
    URL: 'https://enjo7p7os7.execute-api.us-east-1.amazonaws.com/dev/MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const urlsIgnoredInCmr = [{
    URL: 'http://example.com/thisFileIsIgnoredBecauseOfTheRelatedUrlType.exe',
    Type: 'DOWNLOAD SOFTWARE',
    Description: 'File to download',
  }];

  const urlsShouldOnlyInCmr = [{
    URL: `${process.env.DISTRIBUTION_ENDPOINT}s3credentials`,
    Type: 'VIEW RELATED INFORMATION',
    Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
  }];

  const allCmrFiles = matchingFilesInCmr
    .concat(filesOnlyInCmr).concat(urlsShouldOnlyInCmr).concat(urlsIgnoredInCmr);
  const granuleInCmr = {
    GranuleUR: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    ShortName: 'MOD09GQ',
    Version: '006',
    RelatedUrls: allCmrFiles,
  };

  const report = await reconciliationReportForGranuleFiles({
    granuleInDb,
    granuleInCmr,
    bucketsConfig,
    distributionBucketMap,
  });

  t.is(report.okCount, matchingFilesInDb.length + privateFilesInDb.length);

  t.is(report.onlyInCumulus.length, filesOnlyInDb.length);
  t.deepEqual(map(report.onlyInCumulus, 'fileName').sort(), map(filesOnlyInDb, 'fileName').sort());

  t.is(report.onlyInCmr.length, filesOnlyInCmr.length);
  t.deepEqual(map(report.onlyInCmr, 'URL').sort(), map(filesOnlyInCmr, 'URL').sort());
});

test.serial('reconciliationReportForGranuleFiles does not fail if no distribution endpoint is defined', async (t) => {
  const buckets = {
    internal: { name: 'cumulus-test-sandbox-internal', type: 'internal' },
    private: { name: 'testbucket-private', type: 'private' },
    protected: { name: 'testbucket-protected', type: 'protected' },
    public: { name: 'testbucket-public', type: 'public' },
    'protected-2': { name: 'testbucket-protected-2', type: 'protected' },
  };
  const bucketsConfig = new BucketsConfig(buckets);
  const distributionBucketMap = createDistributionBucketMapFromBuckets(buckets);

  const matchingFilesInDb = [{
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    size: 17865615,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
  },
  {
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
  },
  {
    bucket: 'testbucket-protected-2',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
    size: 2708,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
  }];

  const privateFilesInDb = [{
    bucket: 'testbucket-private',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
  }];

  const filesOnlyInDb = [{
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/extra123.jpg',
    size: 44118,
    fileName: 'extra123.jpg',
  },
  {
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/MOD/extra456.jpg',
    size: 44118,
    fileName: 'extra456.jpg',
  }];

  const granuleInDb = {
    granuleId: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    collectionId: constructCollectionId('MOD09GQ', '006'),
    files: matchingFilesInDb.concat(privateFilesInDb).concat(filesOnlyInDb),
  };

  const matchingFilesInCmr = [{
    URL: 's3://testbucket-protected/MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: 's3://testbucket-public/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: 's3://testbucket-protected-2/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const filesOnlyInCmr = [{
    URL: 'https://enjo7p7os7.execute-api.us-east-1.amazonaws.com/dev/MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const urlsShouldOnlyInCmr = [{
    URL: `${process.env.DISTRIBUTION_ENDPOINT}s3credentials`,
    Type: 'VIEW RELATED INFORMATION',
    Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
  }];

  const granuleInCmr = {
    GranuleUR: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    ShortName: 'MOD09GQ',
    Version: '006',
    RelatedUrls: matchingFilesInCmr.concat(filesOnlyInCmr).concat(urlsShouldOnlyInCmr),
  };

  const report = await reconciliationReportForGranuleFiles({
    granuleInDb, granuleInCmr, bucketsConfig, distributionBucketMap,
  });
  t.is(report.okCount, matchingFilesInDb.length + privateFilesInDb.length);

  t.is(report.onlyInCumulus.length, filesOnlyInDb.length);
  t.deepEqual(map(report.onlyInCumulus, 'fileName').sort(), map(filesOnlyInDb, 'fileName').sort());

  t.is(report.onlyInCmr.length, filesOnlyInCmr.length);
  t.deepEqual(map(report.onlyInCmr, 'URL').sort(), map(filesOnlyInCmr, 'URL').sort());
});

test.serial('When report creation fails, reconciliation report status is set to Failed with error', async (t) => {
  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );
  // create an error case
  CMR.prototype.searchConcept.restore();
  const cmrSearchStub = sinon.stub(CMR.prototype, 'searchConcept');
  cmrSearchStub.withArgs('collections').throws(new Error('test error'));

  const reportName = randomId('reportName');
  const event = {
    reportName,
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
  };

  await t.throwsAsync(handler(event));
  const reportKey = `${t.context.stackName}/reconciliation-reports/${reportName}.json`;
  const report = await getJsonS3Object(t.context.systemBucket, reportKey);
  t.is(report.status, 'Failed');
  t.truthy(report.error);
});

test.serial('A valid internal reconciliation report is generated when ES and DB are in sync', async (t) => {
  const {
    knex,
    execution,
    executionCumulusId,
  } = t.context;

  const collection = fakeCollectionRecordFactory();
  const collectionId = constructCollectionId(
    collection.name,
    collection.version
  );
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    collection
  );
  await indexer.indexCollection(
    esClient,
    translatePostgresCollectionToApiCollection(pgCollection),
    esAlias
  );

  const matchingGrans = range(10).map(() => fakeGranuleFactoryV2({
    collectionId,
    execution: execution.url,
  }));
  await Promise.all(
    matchingGrans.map(async (gran) => {
      await indexer.indexGranule(esClient, gran, esAlias);
      const pgGranule = await translateApiGranuleToPostgresGranule({
        dynamoRecord: gran,
        knexOrTransaction: knex,
      });
      await upsertGranuleWithExecutionJoinRecord({
        executionCumulusId,
        granule: pgGranule,
        knexTransaction: knex,
      });
    })
  );

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Internal',
    reportName: randomId('reportName'),
    collectionId,
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');
  t.is(reportRecord.name, event.reportName);
  t.is(reportRecord.type, event.reportType);

  const report = await fetchCompletedReport(reportRecord);
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(report.reportType, 'Internal');
  t.is(report.collections.okCount, 1);
  t.is(report.collections.onlyInEs.length, 0);
  t.is(report.collections.onlyInDb.length, 0);
  t.is(report.collections.withConflicts.length, 0);
  t.is(report.granules.okCount, 10);
  t.is(report.granules.onlyInEs.length, 0);
  t.is(report.granules.onlyInDb.length, 0);
  t.is(report.granules.withConflicts.length, 0);
});

test.serial('Creates a valid Granule Inventory report', async (t) => {
  const {
    granulePgModel,
    knex,
  } = t.context;

  const collection = fakeCollectionRecordFactory();
  const collectionId = constructCollectionId(
    collection.name,
    collection.version
  );
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    collection
  );
  const collectionCumulusId = pgCollection.cumulus_id;
  await indexer.indexCollection(
    esClient,
    translatePostgresCollectionToApiCollection(pgCollection),
    esAlias
  );

  const matchingGrans = range(10).map(() => fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  }));

  await granulePgModel.insert(knex, matchingGrans);

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Granule Inventory',
    reportName: randomId('reportName'),
    collectionId,
    status: 'completed',
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');
  t.is(reportRecord.name, event.reportName);
  t.is(reportRecord.type, event.reportType);

  const report = await fetchCompletedReportString(reportRecord);
  const reportArray = report.split('\n');
  const reportHeader = reportArray.slice(0, 1)[0];
  const reportRows = reportArray.slice(1, reportArray.length);
  const header = '"granuleUr","collectionId","createdAt","startDateTime","endDateTime","status","updatedAt","published","provider"';
  t.is(reportHeader, header);
  t.is(reportRows.length, 10);
});

test.serial('A valid ORCA Backup reconciliation report is generated', async (t) => {
  const collection = fakeCollectionFactory({
    name: 'fakeCollection',
    version: 'v2',
  });
  await indexer.indexCollection(esClient, collection, esAlias);

  const collectionId = constructCollectionId(collection.name, collection.version);

  const matchingCumulusGran = {
    ...fakeGranuleFactoryV2(),
    granuleId: randomId('matchingGranId'),
    collectionId,
    provider: 'fakeProvider2',
    files: [
      {
        bucket: 'cumulus-fake-bucket2',
        fileName: 'fakeFileName2.hdf',
        key: 'fakePath2/fakeFileName2.hdf',
      },
    ],
  };

  const matchingOrcaGran = {
    ...fakeOrcaGranuleFactory(),
    providerId: matchingCumulusGran.provider,
    collectionId: matchingCumulusGran.collectionId,
    id: matchingCumulusGran.granuleId,
    files: [
      {
        name: 'fakeFileName2.hdf',
        cumulusArchiveLocation: 'cumulus-fake-bucket2',
        orcaArchiveLocation: 'orca-bucket2',
        keyPath: 'fakePath2/fakeFileName2.hdf',
      },
    ],
  };

  await indexer.indexGranule(esClient, matchingCumulusGran, esAlias);

  const searchOrcaStub = sinon.stub(ORCASearchCatalogQueue.prototype, 'searchOrca');
  searchOrcaStub.resolves({ anotherPage: false, granules: [matchingOrcaGran] });

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'ORCA Backup',
    reportName: randomId('reportName'),
    collectionId,
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };

  const reportRecord = await handler(event);
  ORCASearchCatalogQueue.prototype.searchOrca.restore();
  t.is(reportRecord.status, 'Generated');
  t.is(reportRecord.name, event.reportName);
  t.is(reportRecord.type, event.reportType);

  const report = await fetchCompletedReport(reportRecord);
  t.truthy(report.granules);
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(report.reportType, 'ORCA Backup');
  t.is(report.granules.okCount, 1);
  t.is(report.granules.cumulusCount, 1);
  t.is(report.granules.orcaCount, 1);
  t.is(report.granules.okFilesCount, 1);
  t.is(report.granules.cumulusFilesCount, 1);
  t.is(report.granules.orcaFilesCount, 1);
  t.is(report.granules.conflictFilesCount, 0);
  t.is(report.granules.onlyInCumulus.length, 0);
  t.is(report.granules.onlyInOrca.length, 0);
  t.is(report.granules.withConflicts.length, 0);
});

test.serial('Internal Reconciliation report JSON is formatted', async (t) => {
  const matchingColls = range(5).map(() => fakeCollectionFactory());
  const collectionId = constructCollectionId(matchingColls[0].name, matchingColls[0].version);
  const matchingGrans = range(10).map(() => fakeGranuleFactoryV2({ collectionId }));
  await Promise.all(
    matchingColls.map((collection) => indexer.indexCollection(esClient, collection, esAlias))
  );
  await Promise.all(
    matchingGrans.map((gran) => indexer.indexGranule(esClient, gran, esAlias))
  );

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Internal',
    reportName: randomId('reportName'),
    collectionId,
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };

  const reportRecord = await handler(event);

  const formattedReport = await fetchCompletedReportString(reportRecord);

  // Force report to unformatted (single line)
  const unformattedReportString = JSON.stringify(JSON.parse(formattedReport), undefined, 0);
  const unformattedReportObj = JSON.parse(unformattedReportString);

  t.true(!unformattedReportString.includes('\n')); // validate unformatted report is on a single line
  t.is(formattedReport, JSON.stringify(unformattedReportObj, undefined, 2));
});

test.serial('Inventory reconciliation report JSON is formatted', async (t) => {
  const dataBuckets = range(2).map(() => randomId('bucket'));
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create random files
  const files = range(10).map((i) => ({
    bucket: dataBuckets[i % dataBuckets.length],
    key: randomId('key'),
    granuleId: randomId('granuleId'),
  }));

  // Store the files to S3
  await Promise.all([
    storeFilesToS3(files),
  ]);

  // Create collections that are in sync
  const matchingColls = range(10).map(() => ({
    name: randomId('name'),
    version: randomId('vers'),
  }));

  const cmrCollections = sortBy(matchingColls, ['name', 'version'])
    .map((collection) => ({
      umm: { ShortName: collection.name, Version: collection.version },
    }));

  CMR.prototype.searchConcept.restore();
  const cmrSearchStub = sinon.stub(CMR.prototype, 'searchConcept');
  cmrSearchStub.withArgs('collections').onCall(0).resolves(cmrCollections);
  cmrSearchStub.withArgs('collections').onCall(1).resolves([]);
  cmrSearchStub.withArgs('granules').resolves([]);

  await storeCollectionsToElasticsearch(matchingColls);

  const eventFormatted = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Inventory',
  };

  const reportRecordFormatted = await handler(eventFormatted);
  const formattedReport = await fetchCompletedReportString(reportRecordFormatted);

  // Force report to unformatted (single line)
  const unformattedReportString = JSON.stringify(JSON.parse(formattedReport), undefined, 0);
  const unformattedReportObj = JSON.parse(unformattedReportString);

  t.true(!unformattedReportString.includes('\n')); // validate unformatted report is on a single line
  t.is(formattedReport, JSON.stringify(unformattedReportObj, undefined, 2));
});

test.serial('When there is a connection termination error for an inventory report, it retries', async (t) => {
  const {
    knex,
  } = t.context;
  const dataBuckets = [randomId('bucket')];
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  const knexStub = sinon.stub(knex, 'select').callsFake(
    // eslint-disable-next-line arrow-body-style
    () => {
      return {
        select: sinon.stub().throws(new Error('Connection terminated unexpectedly', 'PROTOCOL_CONNECTION_LOST')),
      };
    }
  );

  t.teardown(() => knexStub.restore());

  const reportName = randomId('reportName');
  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Inventory',
    reportName,
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
    knex: knexStub,
  };

  await t.throwsAsync(
    handler(event),
    { message: 'Connection terminated unexpectedly' }
  );
  t.is(knexStub.callCount, 4);
  sinon.assert.callCount(knexStub, 4);

  const reportKey = `${t.context.stackName}/reconciliation-reports/${reportName}.json`;
  const report = await getJsonS3Object(t.context.systemBucket, reportKey);
  t.is(report.status, 'Failed');
  t.is(report.reportType, 'Inventory');
});

test.serial('When there is an error for an ORCA backup report, it retries', async (t) => {
  const {
    knex,
  } = t.context;
  const dataBuckets = [randomId('bucket')];
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  const searchOrcaStub = sinon.stub(ORCASearchCatalogQueue.prototype, 'searchOrca');
  searchOrcaStub.throws(new Error('ORCA error'));

  const reportName = randomId('reportName');
  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'ORCA Backup',
    reportName,
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };

  await t.throwsAsync(
    handler(event),
    { message: 'ORCA error' }
  );

  const reportKey = `${t.context.stackName}/reconciliation-reports/${reportName}.json`;
  const report = await getJsonS3Object(t.context.systemBucket, reportKey);
  t.is(report.status, 'Failed');
  t.is(report.reportType, 'ORCA Backup');
});

test.serial('When there is an error when generating the Granule Inventory report, it throws', async (t) => {
  const {
    knex,
  } = t.context;
  const dataBuckets = [randomId('bucket')];
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  const knexStub = sinon.stub(knex, 'select').callsFake(
    // eslint-disable-next-line arrow-body-style
    () => {
      return {
        select: sinon.stub().throws(new Error('Knex error')),
      };
    }
  );

  t.teardown(() => knexStub.restore());

  const reportName = randomId('reportName');
  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Granule Inventory',
    reportName,
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
    knex: knexStub,
  };

  await t.throwsAsync(
    handler(event),
    { message: 'Knex error' }
  );
});

test.serial('When there is an error generating an internal report, it throws', async (t) => {
  const {
    knex,
  } = t.context;
  const dataBuckets = [randomId('bucket')];
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  const esEmptyStub = sinon.stub(ESSearchQueue.prototype, 'empty').throws(new Error('ES error'));

  t.teardown(() => {
    esEmptyStub.restore();
  });

  const reportName = randomId('reportName');
  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    reportType: 'Internal',
    reportName,
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };

  await t.throwsAsync(
    handler(event),
    { message: 'ES error' }
  );

  const reportKey = `${t.context.stackName}/reconciliation-reports/${reportName}.json`;
  const report = await getJsonS3Object(t.context.systemBucket, reportKey);
  t.is(report.status, 'Failed');
  t.is(report.reportType, 'Internal');
});
