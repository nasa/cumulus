'use strict';

const chunk = require('lodash/chunk');
const cloneDeep = require('lodash/cloneDeep');
const pick = require('lodash/pick');
const sortBy = require('lodash/sortBy');
const isEqual = require('lodash/isEqual');
const intersection = require('lodash/intersection');
const union = require('lodash/union');
const omit = require('lodash/omit');
const moment = require('moment');
const pMap = require('p-map');
const pRetry = require('p-retry');

const Logger = require('@cumulus/logger');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { s3 } = require('@cumulus/aws-client/services');
const { ESSearchQueue } = require('@cumulus/es-client/esSearchQueue');
const {
  CollectionPgModel,
  translatePostgresCollectionToApiCollection,
  getKnexClient,
  getCollectionsByGranuleIds,
  getGranulesByApiPropertiesQuery,
  QuerySearchClient,
  translatePostgresGranuleResultToApiGranule,
} = require('@cumulus/db');

const {
  convertToDBCollectionSearchObject,
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParams,
  convertToDBGranuleSearchParams,
  filterDBCollections,
  initialReportHeader,
  compareEsGranuleAndApiGranule,
} = require('../lib/reconciliationReport');

const log = new Logger({ sender: '@api/lambdas/internal-reconciliation-report' });

/**
 * Compare the collection holdings in Elasticsearch with Database
 *
 * @param {Object} recReportParams - lambda's input filtering parameters to
 *                                   narrow limit of report.
 * @returns {Promise<Object>} an object with the okCount, onlyInEs, onlyInDb
 * and withConfilcts
 */
async function internalRecReportForCollections(recReportParams) {
  log.info(`internalRecReportForCollections (${JSON.stringify(recReportParams)})`);
  // compare collection holdings:
  //   Get collection list in ES ordered by granuleId
  //   Get collection list in PostgreSQL ordered by granuleId
  //  Report collections only in ES
  //   Report collections only in PostgreSQL
  //   Report collections with different contents

  const searchParams = convertToESCollectionSearchParams(recReportParams);
  const esCollectionsIterator = new ESSearchQueue(
    { ...searchParams, sort_key: ['name', 'version'] }, 'collection', process.env.ES_INDEX
  );

  const collectionPgModel = new CollectionPgModel();
  const knex = recReportParams.knex || await getKnexClient();

  return await pRetry(
    async () => {
      try {
        // get collections from database and sort them, since the scan result is not ordered
        const [
          updatedAtRangeParams,
          dbSearchParams,
        ] = convertToDBCollectionSearchObject(recReportParams);

        const dbCollectionsSearched = await collectionPgModel.searchWithUpdatedAtRange(
          knex,
          dbSearchParams,
          updatedAtRangeParams
        );

        // TODO - improve this sort
        const dbCollectionItems = sortBy(
          filterDBCollections(dbCollectionsSearched, recReportParams),
          ['name', 'version']
        );

        let okCount = 0;
        const withConflicts = [];
        let onlyInEs = [];
        let onlyInDb = [];

        const fieldsIgnored = ['timestamp', 'updatedAt', 'createdAt'];
        let nextEsItem = await esCollectionsIterator.peek();
        let nextDbItem = dbCollectionItems.length !== 0
          ? translatePostgresCollectionToApiCollection(dbCollectionItems[0])
          : undefined;

        while (nextEsItem && nextDbItem) {
          const esCollectionId = constructCollectionId(nextEsItem.name, nextEsItem.version);
          const dbCollectionId = constructCollectionId(nextDbItem.name, nextDbItem.version);

          if (esCollectionId < dbCollectionId) {
            // Found an item that is only in ES and not in DB
            onlyInEs.push(esCollectionId);
            await esCollectionsIterator.shift(); // eslint-disable-line no-await-in-loop
          } else if (esCollectionId > dbCollectionId) {
            // Found an item that is only in DB and not in ES
            onlyInDb.push(dbCollectionId);
            dbCollectionItems.shift();
          } else {
            // Found an item that is in both ES and DB
            if (
              isEqual(
                omit(nextEsItem, fieldsIgnored),
                omit(
                  nextDbItem,
                  fieldsIgnored
                )
              )
            ) {
              okCount += 1;
            } else {
              withConflicts.push({ es: nextEsItem, db: nextDbItem });
            }
            await esCollectionsIterator.shift(); // eslint-disable-line no-await-in-loop
            dbCollectionItems.shift();
          }

          nextEsItem = await esCollectionsIterator.peek(); // eslint-disable-line no-await-in-loop
          nextDbItem = dbCollectionItems.length !== 0
            ? translatePostgresCollectionToApiCollection(dbCollectionItems[0])
            : undefined;
        }

        // Add any remaining ES items to the report
        onlyInEs = onlyInEs.concat(
          (await esCollectionsIterator.empty())
            .map((item) => constructCollectionId(item.name, item.version))
        );

        // Add any remaining DB items to the report
        onlyInDb = onlyInDb
          .concat(dbCollectionItems.map((item) => constructCollectionId(item.name, item.version)));

        return { okCount, withConflicts, onlyInEs, onlyInDb };
      } catch (error) {
        if (error.message.includes('Connection terminated unexpectedly')) {
          log.error(`Error caught in internalRecReportForCollections. ${error}. Retrying...`);
          throw error;
        }
        log.error(`Error caught in internalRecReportForCollections. ${error}`);
        throw new pRetry.AbortError(error);
      }
    },
    {
      retries: 3,
      onFailedAttempt: (e) => {
        log.error(`Error ${e.message}. Attempt ${e.attemptNumber} failed.`);
      },
    }
  );
}

/**
 * Get all collectionIds from ES and database combined
 *
 * @returns {Promise<Array<string>>} list of collectionIds
 */
async function getAllCollections() {
  const collectionPgModel = new CollectionPgModel();
  const knex = await getKnexClient();

  const dbCollections = (await collectionPgModel.search(knex, {}))
    .map((collection) => constructCollectionId(collection.name, collection.version));

  const esCollectionsIterator = new ESSearchQueue(
    { sort_key: ['name', 'version'], fields: ['name', 'version'] }, 'collection', process.env.ES_INDEX
  );
  const esCollections = (await esCollectionsIterator.empty())
    .map((item) => constructCollectionId(item.name, item.version));

  return union(dbCollections, esCollections);
}

async function getAllCollectionIdsByGranuleIds({
  granuleIds,
  knex,
  concurrency,
}) {
  const collectionIds = new Set();
  await pMap(
    chunk(granuleIds, 100),
    async (granuleIdsBatch) => {
      const collections = await getCollectionsByGranuleIds(knex, granuleIdsBatch);
      collections.forEach(
        (collection) => {
          const collectionId = constructCollectionId(collection.name, collection.version);
          collectionIds.add(collectionId);
        }
      );
    },
    {
      concurrency,
    }
  );
  return [...collectionIds];
}

/**
 * Get list of collections for the given granuleIds
 *
 * @param {Object} recReportParams
 * @param {Array<string>} recReportParams.granuleIds - list of granuleIds
 * @returns {Promise<Array<string>>} list of collectionIds
 */
async function getCollectionsForGranules(recReportParams) {
  const {
    granuleIds,
  } = recReportParams;
  let dbCollectionIds = [];

  await pRetry(
    async () => {
      try {
        dbCollectionIds = await getAllCollectionIdsByGranuleIds(recReportParams);
      } catch (error) {
        if (error.message.includes('Connection terminated unexpectedly')) {
          log.error(`Error caught in getCollectionsForGranules. Error: ${error}. Retrying...`);
          throw error;
        }
        log.error(`Error caught in getCollectionsForGranules. Error ${error}`);
        throw new pRetry.AbortError(error);
      }
    },
    {
      retries: 3,
      onFailedAttempt: (e) => {
        log.error(`Error ${e.message}. Attempt ${e.attemptNumber} failed.`);
      },
    }
  );

  const esGranulesIterator = new ESSearchQueue(
    { granuleId__in: granuleIds.join(','), sort_key: ['collectionId'], fields: ['collectionId'] }, 'granule', process.env.ES_INDEX
  );
  const esCollections = (await esGranulesIterator.empty())
    .map((granule) => (granule ? granule.collectionId : undefined));

  return union(dbCollectionIds, esCollections);
}

/**
 * Get list of collections for granule search based on input filtering parameters
 *
 * @param {Object} recReportParams - lambda's input filtering parameters
 * @returns {Promise<Array<string>>} list of collectionIds
 */
async function getCollectionsForGranuleSearch(recReportParams) {
  const { collectionIds, granuleIds } = recReportParams;
  let collections = [];
  if (granuleIds) {
    const collectionIdsForGranules = await getCollectionsForGranules(recReportParams);
    collections = (collectionIds)
      ? intersection(collectionIds, collectionIdsForGranules)
      : collectionIdsForGranules;
  } else {
    collections = collectionIds || await getAllCollections();
  }
  return collections;
}

/**
 * Compare the granule holdings for a given collection
 *
 * @param {string} collectionId - collection id
 * @param {Object} recReportParams - lambda's input filtering parameters
 * @returns {Promise<Object>} an object with the okCount, onlyInEs, onlyInDb
 * and withConfilcts
 */
async function reportForGranulesByCollectionId(collectionId, recReportParams) {
  //   For each collection,
  //     Get granule list in ES ordered by granuleId
  //     Get granule list in PostgreSQL ordered by granuleId
  //   Report granules only in ES
  //   Report granules only in PostgreSQL
  //   Report granules with different contents

  const esSearchParams = convertToESGranuleSearchParams(recReportParams);
  const esGranulesIterator = new ESSearchQueue(
    {
      ...esSearchParams,
      collectionId,
      sort_key: ['granuleId'],
    },
    'granule',
    process.env.ES_INDEX
  );

  const searchParams = convertToDBGranuleSearchParams({
    ...recReportParams,
    collectionIds: collectionId,
  });
  const granulesSearchQuery = getGranulesByApiPropertiesQuery(
    recReportParams.knex,
    searchParams,
    ['collectionName', 'collectionVersion', 'granule_id']
  );
  const pgGranulesSearchClient = new QuerySearchClient(
    granulesSearchQuery,
    100 // arbitrary limit on how items are fetched at once
  );

  let okCount = 0;
  const withConflicts = [];
  const onlyInEs = [];
  const onlyInDb = [];
  const granuleFields = ['granuleId', 'collectionId', 'provider', 'createdAt', 'updatedAt'];

  let [nextEsItem, nextDbItem] = await Promise.all([esGranulesIterator.peek(), pgGranulesSearchClient.peek()]); // eslint-disable-line max-len

  /* eslint-disable no-await-in-loop */
  while (nextEsItem && nextDbItem) {
    if (nextEsItem.granuleId < nextDbItem.granule_id) {
      // Found an item that is only in ES and not in DB
      onlyInEs.push(pick(nextEsItem, granuleFields));
      await esGranulesIterator.shift();
    } else if (nextEsItem.granuleId > nextDbItem.granule_id) {
      const apiGranule = await translatePostgresGranuleResultToApiGranule(
        recReportParams.knex,
        nextDbItem
      );

      // Found an item that is only in DB and not in ES
      onlyInDb.push(pick(apiGranule, granuleFields));
      await pgGranulesSearchClient.shift();
    } else {
      const apiGranule = await translatePostgresGranuleResultToApiGranule(
        recReportParams.knex,
        nextDbItem
      );

      // Found an item that is in both ES and DB
      if (compareEsGranuleAndApiGranule(nextEsItem, apiGranule)) {
        okCount += 1;
      } else {
        withConflicts.push({ es: nextEsItem, db: apiGranule });
      }
      await Promise.all([esGranulesIterator.shift(), pgGranulesSearchClient.shift()]);
    }

    [nextEsItem, nextDbItem] = await Promise.all([esGranulesIterator.peek(), pgGranulesSearchClient.peek()]); // eslint-disable-line max-len
  }

  // Add any remaining ES items to the report
  while (await esGranulesIterator.peek()) {
    const item = await esGranulesIterator.shift();
    onlyInEs.push(pick(item, granuleFields));
  }

  // Add any remaining DB items to the report
  while (await pgGranulesSearchClient.peek()) {
    const item = await pgGranulesSearchClient.shift();
    const apiGranule = await translatePostgresGranuleResultToApiGranule(recReportParams.knex, item);
    onlyInDb.push(pick(apiGranule, granuleFields));
  }
  /* eslint-enable no-await-in-loop */

  return { okCount, withConflicts, onlyInEs, onlyInDb };
}

/**
 * Compare the granule holdings in Elasticsearch with Database
 *
 * @param {Object} recReportParams - lambda's input filtering parameters to
 *                                   narrow limit of report.
 * @returns {Promise<Object>} an object with the okCount, onlyInEs, onlyInDb
 * and withConfilcts
 */
async function internalRecReportForGranules(recReportParams) {
  log.debug('internal-reconciliation-report internalRecReportForGranules');
  log.info(`internalRecReportForGranules (${JSON.stringify(recReportParams)})`);
  // To avoid 'scan' granules table, we query a Global Secondary Index(GSI) in granules
  // table with collectionId.
  // compare granule holdings:
  //   Get collections list from db and es based on request parameters or use the collectionId
  //     from the request
  //   For each collection,
  //     compare granule holdings and get report
  //   Report granules only in ES
  //   Report granules only in PostgreSQL
  //   Report granules with different contents

  const collections = await getCollectionsForGranuleSearch(recReportParams);

  const searchParams = omit(recReportParams, ['collectionIds']);

  const reports = await pMap(
    collections,
    (collectionId) => reportForGranulesByCollectionId(collectionId, searchParams),
    {
      concurrency: recReportParams.concurrency,
    }
  );

  const report = {};
  report.okCount = reports
    .reduce((accumulator, currentValue) => accumulator + currentValue.okCount, 0);
  report.withConflicts = reports
    .reduce((accumulator, currentValue) => accumulator.concat(currentValue.withConflicts), []);
  report.onlyInEs = reports
    .reduce((accumulator, currentValue) => accumulator.concat(currentValue.onlyInEs), []);
  report.onlyInDb = reports
    .reduce((accumulator, currentValue) => accumulator.concat(currentValue.onlyInDb), []);

  return report;
}

/**
 * Create a Internal Reconciliation report and save it to S3
 *
 * @param {Object} recReportParams - params
 * @param {Object} recReportParams.collectionIds - array of collectionIds
 * @param {Object} recReportParams.reportType - the report type
 * @param {moment} recReportParams.createStartTime - when the report creation was begun
 * @param {moment} recReportParams.endTimestamp - ending report datetime ISO Timestamp
 * @param {string} recReportParams.reportKey - the s3 report key
 * @param {string} recReportParams.stackName - the name of the CUMULUS stack
 * @param {moment} recReportParams.startTimestamp - beginning report datetime ISO timestamp
 * @param {string} recReportParams.systemBucket - the name of the CUMULUS system bucket
 * @returns {Promise<null>} a Promise that resolves when the report has been
 *   uploaded to S3
 */
async function createInternalReconciliationReport(recReportParams) {
  log.info(`createInternalReconciliationReport parameters ${JSON.stringify(recReportParams)}`);
  const {
    reportKey,
    systemBucket,
  } = recReportParams;

  // Write an initial report to S3
  const initialReportFormat = {
    okCount: 0,
    withConflicts: [],
    onlyInEs: [],
    onlyInDb: [],
  };

  let report = {
    ...initialReportHeader(recReportParams),
    collections: cloneDeep(initialReportFormat),
    granules: cloneDeep(initialReportFormat),
  };

  try {
    await s3().putObject({
      Bucket: systemBucket,
      Key: reportKey,
      Body: JSON.stringify(report, undefined, 2),
    });

    const [collectionsReport, granulesReport] = await Promise.all([
      internalRecReportForCollections(recReportParams),
      internalRecReportForGranules(recReportParams),
    ]);
    report = Object.assign(report, { collections: collectionsReport, granules: granulesReport });

    // Create the full report
    report.createEndTime = moment.utc().toISOString();
    report.status = 'SUCCESS';

    // Write the full report to S3
    return s3().putObject({
      Bucket: systemBucket,
      Key: reportKey,
      Body: JSON.stringify(report, undefined, 2),
    });
  } catch (error) {
    log.error(`Error caught in createInternalReconciliationReport. ${error}`);
    // Create the full report
    report.createEndTime = moment.utc().toISOString();
    report.status = 'Failed';

    // Write the full report to S3
    await s3().putObject({
      Bucket: systemBucket,
      Key: reportKey,
      Body: JSON.stringify(report, undefined, 2),
    });
    throw error;
  }
}

module.exports = {
  compareEsGranuleAndApiGranule,
  internalRecReportForCollections,
  internalRecReportForGranules,
  createInternalReconciliationReport,
};
