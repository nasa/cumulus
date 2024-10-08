//@ts-check

'use strict';

const cloneDeep = require('lodash/cloneDeep');
const keyBy = require('lodash/keyBy');
const pickBy = require('lodash/pickBy');
const camelCase = require('lodash/camelCase');
const moment = require('moment');

const { buildS3Uri, getJsonS3Object } = require('@cumulus/aws-client/S3');
const S3ListObjectsV2Queue = require('@cumulus/aws-client/S3ListObjectsV2Queue');
const { s3 } = require('@cumulus/aws-client/services');
const BucketsConfig = require('@cumulus/common/BucketsConfig');
const { getBucketsConfigKey } = require('@cumulus/common/stack');
const { fetchDistributionBucketMap } = require('@cumulus/distribution-utils');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');

const { CMRSearchConceptQueue } = require('@cumulus/cmr-client');
const { constructOnlineAccessUrl, getCmrSettings } = require('@cumulus/cmrjs/cmr-utils');
const {
  getFilesAndGranuleInfoQuery,
  getKnexClient,
  QuerySearchClient,
  getUniqueCollectionsByGranuleFilter,
  getGranulesByApiPropertiesQuery,
  translatePostgresFileToApiFile,
} = require('@cumulus/db');
const Logger = require('@cumulus/logger');
const { getEsClient } = require('@cumulus/es-client/search');
const { indexReconciliationReport } = require('@cumulus/es-client/indexer');

const {
  ReconciliationReportPgModel,
  translatePostgresReconReportToApiReconReport,
} = require('@cumulus/db');
const { createGranuleInventoryReport } = require('./reports/granule-inventory-report');
const { createOrcaBackupReconciliationReport } = require('./reports/orca-backup-reconciliation-report');
const { errorify, filenamify } = require('../lib/utils');
const {
  cmrGranuleSearchParams,
  convertToDBGranuleSearchParams,
  initialReportHeader,
} = require('../lib/reconciliationReport');

const log = new Logger({ sender: '@api/lambdas/create-reconciliation-report' });

const isDataBucket = (bucketConfig) => ['private', 'public', 'protected'].includes(bucketConfig.type);

// Typescript annotations
/**
 * @typedef {typeof process.env } ProcessEnv
 * @typedef {import('knex').Knex} Knex
 * @typedef {import('@cumulus/es-client/search').EsClient} EsClient
 * @typedef {import('../lib/types').NormalizedRecReportParams } NormalizedRecReportParams
 * @typedef {import('@cumulus/cmr-client/CMR').CMRConstructorParams} CMRSettings
 */

/**
 * @typedef {Object} Env
 * @property {string} [CONCURRENCY] - The concurrency level for processing.
 * @property {string} [ES_INDEX] - The Elasticsearch index.
 * @property {string} [AWS_REGION] - The AWS region.
 * @property {string} [AWS_ACCESS_KEY_ID] - The AWS access key ID.
 * @property {string} [AWS_SECRET_ACCESS_KEY] - The AWS secret access key.
 * @property {string} [AWS_SESSION_TOKEN] - The AWS session token.
 * @property {string} [NODE_ENV] - The Node.js environment (e.g., 'development', 'production').
 * @property {string} [DATABASE_URL] - The database connection URL.
 * @property {string} [key] string - Any other environment variable as a string.
 */

/**
 * @typedef {Object} CMRCollectionItem
 * @property {Object} umm - The UMM (Unified Metadata Model) object for the granule.
 * @property {string} umm.ShortName - The short name of the collection.
 * @property {string} umm.Version - The version of the collection.
 * @property {Array<Object>} umm.RelatedUrls - The related URLs for the granule.
 */

/**
 * @typedef {Object} CMRItem
 * @property {Object} umm - The UMM (Unified Metadata Model) object for the granule.
 * @property {string} umm.GranuleUR - The unique identifier for the granule in CMR.
 * @property {Object} umm.CollectionReference - The collection reference object.
 * @property {string} umm.CollectionReference.ShortName - The short name of the collection.
 * @property {string} umm.CollectionReference.Version - The version of the collection.
 * @property {Array<Object>} umm.RelatedUrls - The related URLs for the granule.
 */

/**
 * @typedef {Object} DbItem
 * @property {string} granule_id - The unique name for the granule (per collection)
 * @property {number} cumulus_id - The unique identifier for the granule record in the database.
 * @property {Date} updated_at - The last updated timestamp for the granule in the database.
 */

/**
 * @typedef {Object} GranulesReport
 * @property {number} okCount - The count of OK granules.
 * @property {Array<{GranuleUR: string, ShortName: string, Version: string}>} onlyInCmr
 * - The list of granules only in Cumulus.
 * @property {Array<{granuleId: string, collectionId: string}>} onlyInCumulus
 */
/**
 *
 * @param {string} reportType - reconciliation report type
 * @returns {boolean} - Whether or not to include the link between files and
 * granules in the report.
 */
const linkingFilesToGranules = (reportType) => reportType === 'Granule Not Found';

/**
 * Checks to see if any of the included reportParams contains a value that
 * would turn a Cumulus Vs CMR collection comparison into a one way report.
 *
 * @param {Object} reportParams
 * @returns {boolean} Returns true if any tested key exists on the input
 *                    object and the key references a defined value.
 */
function isOneWayCollectionReport(reportParams) {
  return [
    'startTimestamp',
    'endTimestamp',
    'granuleIds',
    'providers',
  ].some((e) => !!reportParams[e]);
}

/**
 * Decide whether we compare all found S3 objects with the database or not.

 * @param {Object} reportParams
 * @returns {boolean} True, when the bucket comparison should only be done from
 *                    the database to objects found on s3.
 */
const isOneWayBucketReport = (reportParams) => [
  'providers',
  'granuleIds',
  'collectionIds',
].some((testParam) => !!reportParams[testParam]);

/**
 * Checks to see if any of the included reportParams contains a value that
 * would turn a Cumulus Vs CMR granule comparison into a one way report.
 *
 * @param {Object} reportParams
 * @returns {boolean} Returns true if any tested key exists on the input
 *                    object and the key references a defined value.
 */
function isOneWayGranuleReport(reportParams) {
  return [
    'startTimestamp',
    'endTimestamp',
    'providers',
  ].some((e) => !!reportParams[e]);
}

/**
 * Fetches collections from the CMR (Common Metadata Repository) and returns their IDs.
 *
 * @param {NormalizedRecReportParams} recReportParams - The parameters for the function.
 * @returns {Promise<string[]>} A promise that resolves to an array of collection IDs from the CMR.
 *
 * @example
 * await fetchCMRCollections({ collectionIds: ['COLLECTION_1', 'COLLECTION_2'] });
 */
async function fetchCMRCollections({ collectionIds }) {
  const cmrSettings = await getCmrSettings();
  const cmrCollectionsIterator = /** @type {CMRSearchConceptQueue<CMRCollectionItem>} */(
    new CMRSearchConceptQueue({
      cmrSettings,
      type: 'collections',
      format: 'umm_json',
    }));

  const allCmrCollectionIds = [];
  let nextCmrItem = await cmrCollectionsIterator.shift();
  while (nextCmrItem) {
    allCmrCollectionIds.push(
      constructCollectionId(nextCmrItem.umm.ShortName, nextCmrItem.umm.Version)
    );
    nextCmrItem
      // eslint-disable-next-line no-await-in-loop
      = /** @type {CMRCollectionItem | null} */ (await cmrCollectionsIterator.shift());
  }

  const cmrCollectionIds = allCmrCollectionIds.sort();

  if (!collectionIds) return cmrCollectionIds;
  return cmrCollectionIds.filter((item) => collectionIds.includes(item));
}

/**
 * Fetches collections from the database based on the provided parameters.
 *
 * @param {NormalizedRecReportParams} recReportParams - The reconciliation report parameters.
 * @param {Knex} knex - The Knex.js database connection.
 * @returns {Promise<string[]>} A promise that resolves to an array of collection IDs.
 */
async function fetchDbCollections(recReportParams, knex) {
  const {
    collectionIds,
    granuleIds,
    providers,
    startTimestamp,
    endTimestamp,
  } = recReportParams;
  if (providers || granuleIds || startTimestamp || endTimestamp) {
    const filteredDbCollections = await getUniqueCollectionsByGranuleFilter({
      knex: knex,
      ...recReportParams,
    });
    return filteredDbCollections.map((collection) =>
      constructCollectionId(collection.name, collection.version));
  }
  const query = knex('collections')
    .select('cumulus_id', 'name', 'version');
  if (startTimestamp) {
    query.where('updated_at', '>=', startTimestamp);
  }
  if (endTimestamp) {
    query.where('updated_at', '<=', endTimestamp);
  }
  if (collectionIds) {
    collectionIds.forEach((collectionId) => {
      const { name, version } = deconstructCollectionId(collectionId);
      query.orWhere({ name, version });
    });
  }
  query.orderBy(['name', 'version']);
  const dbCollections = await query;
  return dbCollections.map((collection) =>
    constructCollectionId(collection.name, collection.version));
}

/**
 * Verify that all objects in an S3 bucket contain corresponding entries in
 * PostgreSQL, and that there are no extras in either S3 or PostgreSQL
 *
 * @param {string} Bucket - the bucket containing files to be reconciled
 * @param {Object} recReportParams - input report params.
 * @returns {Promise<Object>} a report
 */
async function createReconciliationReportForBucket(Bucket, recReportParams) {
  const s3ObjectsQueue = new S3ListObjectsV2Queue({ Bucket });
  const linkFilesAndGranules = linkingFilesToGranules(recReportParams.reportType);
  const oneWayBucketReport = isOneWayBucketReport(recReportParams);
  if (oneWayBucketReport) log.debug('Creating one way report, reconciliation report will not report objects only in S3');

  const query = getFilesAndGranuleInfoQuery({
    knex: recReportParams.knex,
    searchParams: { bucket: Bucket },
    sortColumns: ['key'],
    granuleColumns: ['granule_id'],
    collectionIds: recReportParams.collectionIds,
    providers: recReportParams.provider,
    granuleIds: recReportParams.granuleIds,
  });

  const pgFileSearchClient = new QuerySearchClient(query, 100);

  let okCount = 0;
  const onlyInS3 = [];
  const onlyInDb = [];
  const okCountByGranule = {};

  log.info(`createReconciliationReportForBucket(S3 vs. PostgreSQL): ${Bucket}: ${JSON.stringify(recReportParams)}`);
  log.info('Comparing PostgreSQL to S3');
  let [nextS3Object, nextPgItem] = await Promise.all([
    s3ObjectsQueue.peek(),
    pgFileSearchClient.peek(),
  ]);

  while (nextS3Object && nextPgItem) {
    const nextS3Uri = buildS3Uri(Bucket, nextS3Object.Key);
    const nextPgFileUri = buildS3Uri(Bucket, nextPgItem.key);

    if (linkFilesAndGranules && !okCountByGranule[nextPgItem.granule_id]) {
      okCountByGranule[nextPgItem.granule_id] = 0;
    }

    if (nextS3Uri < nextPgFileUri) {
      // Found an item that is only in S3 and not in PostgreSQL
      if (!oneWayBucketReport) onlyInS3.push(nextS3Uri);
      await s3ObjectsQueue.shift(); // eslint-disable-line no-await-in-loop
    } else if (nextS3Uri > nextPgFileUri) {
      // Found an item that is only in PostgreSQL and not in S3
      const pgItem = await pgFileSearchClient.shift(); // eslint-disable-line no-await-in-loop, max-len
      onlyInDb.push({
        uri: buildS3Uri(Bucket, pgItem.key),
        granuleId: pgItem.granule_id,
      });
    } else {
      // Found an item that is in both S3 and PostgreSQL
      okCount += 1;
      if (linkFilesAndGranules) {
        okCountByGranule[nextPgItem.granule_id] += 1;
      }
      await s3ObjectsQueue.shift(); // eslint-disable-line no-await-in-loop
      await pgFileSearchClient.shift(); // eslint-disable-line no-await-in-loop
    }

    // eslint-disable-next-line no-await-in-loop
    [nextS3Object, nextPgItem] = await Promise.all([
      s3ObjectsQueue.peek(),
      pgFileSearchClient.peek(),
    ]);
  }

  // Add any remaining S3 items to the report
  log.info('Adding remaining S3 items to the report');
  if (!oneWayBucketReport) {
    while (await s3ObjectsQueue.peek()) { // eslint-disable-line no-await-in-loop
      const s3Object = await s3ObjectsQueue.shift(); // eslint-disable-line no-await-in-loop
      onlyInS3.push(buildS3Uri(Bucket, s3Object.Key));
    }
  }

  // Add any remaining PostgreSQL items to the report
  log.info('Adding remaining PostgreSQL items to the report');
  while (await pgFileSearchClient.peek()) { // eslint-disable-line no-await-in-loop
    const pgItem = await pgFileSearchClient.shift(); // eslint-disable-line no-await-in-loop
    onlyInDb.push({
      uri: buildS3Uri(Bucket, pgItem.key),
      granuleId: pgItem.granule_id,
    });
  }
  log.info('Compare PostgreSQL to S3 completed');

  log.info(`createReconciliationReportForBucket ${Bucket} returning `
    + `okCount: ${okCount}, onlyInS3: ${onlyInS3.length}, `
    + `onlyInDb: ${onlyInDb.length}, `
    + `okCountByGranule: ${Object.keys(okCountByGranule).length}`);
  return {
    okCount,
    onlyInS3,
    onlyInDb,
    okCountByGranule,
  };
}

/**
 * Compare the collection holdings in CMR with Cumulus
 *
 * @param {NormalizedRecReportParams} recReportParams - lambda's input filtering parameters to
 *                                   narrow limit of report.
 * @param {Knex} knex - Database client for interacting with PostgreSQL database
 * @returns {Promise<Object>} an object with the okCollections, onlyInCumulus and
 * onlyInCmr
 */
async function reconciliationReportForCollections(recReportParams, knex) {
  // compare collection holdings:
  //   Get list of collections from CMR
  //   Get list of collections from CUMULUS
  //   Report collections only in CMR
  //   Report collections only in CUMULUS
  log.info(`reconciliationReportForCollections (${JSON.stringify(recReportParams)})`);
  const oneWayReport = isOneWayCollectionReport(recReportParams);
  log.debug(`Creating one way report: ${oneWayReport}`);

  const okCollections = [];
  let collectionsOnlyInCumulus = [];
  let collectionsOnlyInCmr = [];

  try {
    // get all collections from CMR and sort them, since CMR query doesn't support
    // 'Version' as sort_key
    log.debug('Fetching collections from CMR.');
    const cmrCollectionIds = (await fetchCMRCollections(recReportParams)).sort();
    const dbCollectionIds = (await fetchDbCollections(recReportParams, knex)).sort();

    log.info(`Comparing ${JSON.stringify(cmrCollectionIds)} CMR collections to ${dbCollectionIds} PostgreSQL collections`);
    log.info(`Comparing ${cmrCollectionIds.length} CMR collections to ${dbCollectionIds.length} PostgreSQL collections`);

    /** @type {string | undefined } */
    let nextDbCollectionId = dbCollectionIds[0];
    /** @type {string | undefined } */
    let nextCmrCollectionId = cmrCollectionIds[0];

    while (nextDbCollectionId && nextCmrCollectionId) {
      if (nextDbCollectionId < nextCmrCollectionId) {
        // Found an item that is only in Cumulus database and not in cmr
        dbCollectionIds.shift();
        collectionsOnlyInCumulus.push(nextDbCollectionId);
      } else if (nextDbCollectionId > nextCmrCollectionId) {
        // Found an item that is only in cmr and not in Cumulus database
        if (!oneWayReport) collectionsOnlyInCmr.push(nextCmrCollectionId);
        cmrCollectionIds.shift();
      } else {
        // Found an item that is in both cmr and database
        okCollections.push(nextDbCollectionId);
        dbCollectionIds.shift();
        cmrCollectionIds.shift();
      }

      nextDbCollectionId = (dbCollectionIds.length !== 0) ? dbCollectionIds[0] : undefined;
      nextCmrCollectionId = (cmrCollectionIds.length !== 0) ? cmrCollectionIds[0] : undefined;
    }

    // Add any remaining database items to the report
    collectionsOnlyInCumulus = collectionsOnlyInCumulus.concat(dbCollectionIds);

    // Add any remaining CMR items to the report
    if (!oneWayReport) collectionsOnlyInCmr = collectionsOnlyInCmr.concat(cmrCollectionIds);
  } catch (error) {
    log.error(`Error caught in reconciliationReportForCollections. with params ${JSON.stringify(recReportParams)}`);
    log.error(errorify(error));
    throw error;
  }
  log.info(`reconciliationReportForCollections returning {okCollections: ${okCollections.length}, onlyInCumulus: ${collectionsOnlyInCumulus.length}, onlyInCmr: ${collectionsOnlyInCmr.length}}`);
  return {
    okCollections,
    onlyInCumulus: collectionsOnlyInCumulus,
    onlyInCmr: collectionsOnlyInCmr,
  };
}

/**
 * Compare the file holdings in CMR with Cumulus for a given granule
 * @param {Object} params .                      - parameters
 * @param {Object} params.granuleInDb            - granule object in database
 * @param {Object} params.granuleInCmr           - granule object in CMR
 * @param {Object} params.bucketsConfig          - bucket configuration
 * @param {Object} params.distributionBucketMap  - mapping of bucket->distirubtion path values
 *                                                 (e.g. { bucket: distribution path })
 * @returns {Promise<Object>}    - an object with the okCount, onlyInCumulus, onlyInCmr
 */
async function reconciliationReportForGranuleFiles(params) {
  if (!process.env.DISTRIBUTION_ENDPOINT) {
    throw new Error('DISTRIBUTION_ENDPOINT is not defined in function environment variables, but is required');
  }
  const distEndpoint = process.env.DISTRIBUTION_ENDPOINT;
  const { granuleInDb, granuleInCmr, bucketsConfig, distributionBucketMap } = params;
  let okCount = 0;
  const onlyInCumulus = [];
  const onlyInCmr = [];
  try {
    const granuleFiles = keyBy(granuleInDb.files, 'fileName');

    // URL types for downloading granule files
    const cmrGetDataTypes = ['GET DATA', 'GET DATA VIA DIRECT ACCESS', 'GET RELATED VISUALIZATION', 'EXTENDED METADATA'];
    const cmrRelatedDataTypes = ['VIEW RELATED INFORMATION'];

    const bucketTypes = Object.values(bucketsConfig.buckets)
      .reduce(
        (acc, { name, type }) => ({ ...acc, [name]: type }),
        {}
      );

    // check each URL entry against database records
    const relatedUrlPromises = granuleInCmr.RelatedUrls.map(async (relatedUrl) => {
      // only check URL types for downloading granule files and related data (such as documents)
      if (cmrGetDataTypes.includes(relatedUrl.Type)
        || cmrRelatedDataTypes.includes(relatedUrl.Type)) {
        const urlFileName = relatedUrl.URL.split('/').pop();

        // filename in both Cumulus and CMR
        if (granuleFiles[urlFileName] && bucketsConfig.key(granuleFiles[urlFileName].bucket)) {
          // not all files should be in CMR
          const distributionAccessUrl = await constructOnlineAccessUrl({
            file: granuleFiles[urlFileName],
            distEndpoint,
            bucketTypes,
            urlType: 'distribution',
            distributionBucketMap,
          });

          const s3AccessUrl = await constructOnlineAccessUrl({
            file: granuleFiles[urlFileName],
            distEndpoint,
            bucketTypes,
            urlType: 's3',
            distributionBucketMap,
            useDirectS3Type: true,
          });

          if (distributionAccessUrl && relatedUrl.URL === distributionAccessUrl.URL) {
            okCount += 1;
          } else if (s3AccessUrl && relatedUrl.URL === s3AccessUrl.URL) {
            okCount += 1;
          } else if (cmrGetDataTypes.includes(relatedUrl.Type)) {
            // ignore any URL which is not for getting data
            // some files should not be in CMR such as private files
            onlyInCmr.push({
              URL: relatedUrl.URL,
              Type: relatedUrl.Type,
              GranuleUR: granuleInCmr.GranuleUR,
            });
          }

          delete granuleFiles[urlFileName];
        } else if (cmrGetDataTypes.includes(relatedUrl.Type)) {
          // no matching database file, only in CMR
          onlyInCmr.push({
            URL: relatedUrl.URL,
            Type: relatedUrl.Type,
            GranuleUR: granuleInCmr.GranuleUR,
          });
        }
      }
    });

    await Promise.all(relatedUrlPromises);

    // any remaining database items to the report
    Object.keys(granuleFiles).forEach((fileName) => {
      // private file only in database, it's ok
      if (bucketsConfig.key(granuleFiles[fileName].bucket)
        && bucketsConfig.type(granuleFiles[fileName].bucket) === 'private') {
        okCount += 1;
      } else {
        let uri = granuleFiles[fileName].source;
        if (granuleFiles[fileName].bucket && granuleFiles[fileName].key) {
          uri = buildS3Uri(granuleFiles[fileName].bucket, granuleFiles[fileName].key);
        }

        onlyInCumulus.push({
          fileName: fileName,
          uri,
          granuleId: granuleInDb.granuleId,
        });
      }
    });
  } catch (error) {
    log.error(`Error caught in reconciliationReportForGranuleFiles(${granuleInDb.granuleId})`);
    log.error(errorify(error));
    throw error;
  }
  return { okCount, onlyInCumulus, onlyInCmr };
}
// export for testing
exports.reconciliationReportForGranuleFiles = reconciliationReportForGranuleFiles;

/**
 * Compare the granule holdings in CMR with Cumulus for a given collection
 *
 * @param {Object} params                          - parameters
 * @param {string} params.collectionId             - the collection which has the granules to be
 *                                                   reconciled
 * @param {Object} params.bucketsConfig            - bucket configuration object
 * @param {Object} params.distributionBucketMap    - mapping of bucket->distirubtion path values
 *                                                   (e.g. { bucket: distribution path })
 * @param {NormalizedRecReportParams} params.recReportParams - Lambda report paramaters for
 *                                                             narrowing focus
 * @param {Object} params.knex                     - Database client for interacting with PostgreSQL
 *                                                   database
 * @returns {Promise<Object>}                      - an object with the granulesReport and
 *                                                   filesReport
 */
async function reconciliationReportForGranules(params) {
  // compare granule holdings:
  //   Get CMR granules list (by PROVIDER, short_name, version, sort_key: ['granule_ur'])
  //   Get CUMULUS granules list (by collectionId order by granuleId)
  //   Report granules only in CMR
  //   Report granules only in CUMULUS
  log.info(`reconciliationReportForGranules(${params.collectionId})`);
  const { collectionId, bucketsConfig, distributionBucketMap, recReportParams, knex } = params;
  const { name, version } = deconstructCollectionId(collectionId);

  /** @type {GranulesReport} */
  const granulesReport = { okCount: 0, onlyInCumulus: [], onlyInCmr: [] };
  const filesReport = { okCount: 0, onlyInCumulus: [], onlyInCmr: [] };
  try {
    const cmrSettings = /** @type CMRSettings */(await getCmrSettings());
    const searchParams = new URLSearchParams({ short_name: name, version: version, sort_key: 'granule_ur' });
    cmrGranuleSearchParams(recReportParams).forEach(([paramName, paramValue]) => {
      searchParams.append(paramName, paramValue);
    });

    log.debug(`fetch CMRSearchConceptQueue(${collectionId}) with searchParams: ${JSON.stringify(searchParams)}`);
    const cmrGranulesIterator
    = /** @type {CMRSearchConceptQueue<CMRItem>} */(new CMRSearchConceptQueue({
      cmrSettings,
      type: 'granules',
      searchParams,
      format: 'umm_json',
    }));

    const dbSearchParams = convertToDBGranuleSearchParams({
      ...recReportParams,
      collectionIds: [collectionId],
    });
    const granulesSearchQuery = getGranulesByApiPropertiesQuery({
      knex,
      searchParams: { ...dbSearchParams, collate: 'C' },
      sortByFields: 'granules.granule_id',
    });

    const pgGranulesIterator = /** @type {QuerySearchClient<DbItem>} */(new QuerySearchClient(
      granulesSearchQuery,
      100 // arbitrary limit on how items are fetched at once
    ));

    const oneWay = isOneWayGranuleReport(recReportParams);
    log.debug(`is oneWay granule report: ${collectionId}, ${oneWay}`);

    let [nextDbItem, nextCmrItem] = await Promise.all(
      [(pgGranulesIterator.peek()), cmrGranulesIterator.peek()]
    );

    while (nextDbItem && nextCmrItem) {
      const nextDbGranuleId = nextDbItem.granule_id; // TODO typing :( -- oops.
      const nextCmrGranuleId = nextCmrItem.umm.GranuleUR;

      if (nextDbGranuleId < nextCmrGranuleId) {
        // Found an item that is only in Cumulus database and not in CMR
        granulesReport.onlyInCumulus.push({
          granuleId: nextDbGranuleId,
          collectionId: collectionId,
        });
        await pgGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      } else if (nextDbGranuleId > nextCmrGranuleId) {
        // Found an item that is only in CMR and not in Cumulus database
        if (!oneWay) {
          granulesReport.onlyInCmr.push({
            GranuleUR: nextCmrGranuleId,
            ShortName: nextCmrItem.umm.CollectionReference.ShortName,
            Version: nextCmrItem.umm.CollectionReference.Version,
          });
        }
        await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      } else {
        // Found an item that is in both CMR and Cumulus database
        granulesReport.okCount += 1;
        // eslint-disable-next-line no-await-in-loop
        const postgresGranuleFiles = await getFilesAndGranuleInfoQuery({
          knex,
          searchParams: { granule_cumulus_id: nextDbItem.cumulus_id },
          sortColumns: ['key'],
        });
        const granuleInDb = {
          granuleId: nextDbGranuleId,
          collectionId: collectionId,
          files: postgresGranuleFiles.map((f) => translatePostgresFileToApiFile(f)),
        };
        const granuleInCmr = {
          GranuleUR: nextCmrGranuleId,
          ShortName: nextCmrItem.umm.CollectionReference.ShortName,
          Version: nextCmrItem.umm.CollectionReference.Version,
          RelatedUrls: nextCmrItem.umm.RelatedUrls,
        };
        await pgGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
        await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop

        // TODO - this is an api granule file object.
        // compare the files now to avoid keeping the granules' information in memory
        // eslint-disable-next-line no-await-in-loop
        const fileReport = await reconciliationReportForGranuleFiles({
          granuleInDb, granuleInCmr, bucketsConfig, distributionBucketMap,
        });
        filesReport.okCount += fileReport.okCount;
        filesReport.onlyInCumulus = filesReport.onlyInCumulus.concat(fileReport.onlyInCumulus);
        filesReport.onlyInCmr = filesReport.onlyInCmr.concat(fileReport.onlyInCmr);
      }

      [nextDbItem, nextCmrItem] = await Promise.all([pgGranulesIterator.peek(), cmrGranulesIterator.peek()]); // eslint-disable-line max-len, no-await-in-loop
    }

    // Add any remaining PostgreSQL items to the report
    while (await pgGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
      const dbItem = await pgGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      if (!dbItem) {
        throw new Error('database returned item is null in reconciliationReportForGranules');
      }
      granulesReport.onlyInCumulus.push({
        granuleId: dbItem.granule_id,
        collectionId: collectionId,
      });
    }

    // Add any remaining CMR items to the report
    if (!oneWay) {
      while (await cmrGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
        const cmrItem = await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
        if (!cmrItem) {
          throw new Error('CMR returned item is null in reconciliationReportForGranules');
        }
        granulesReport.onlyInCmr.push({
          GranuleUR: cmrItem.umm.GranuleUR,
          ShortName: nextCmrItem.umm.CollectionReference.ShortName,
          Version: nextCmrItem.umm.CollectionReference.Version,
        });
      }
    }
  } catch (error) {
    log.error(`Error caught in reconciliationReportForGranules(${collectionId})`);
    log.error(errorify(error));
    throw error;
  }
  log.info(`returning reconciliationReportForGranules(${collectionId}) granulesReport: `
    + `okCount: ${granulesReport.okCount} onlyInCumulus: ${granulesReport.onlyInCumulus.length}, `
    + `onlyInCmr: ${granulesReport.onlyInCmr.length}`);
  log.info(`returning reconciliationReportForGranules(${collectionId}) filesReport: `
    + `okCount: ${filesReport.okCount}, onlyInCumulus: ${filesReport.onlyInCumulus.length}, `
    + `onlyInCmr: ${filesReport.onlyInCmr.length}`);
  return {
    granulesReport,
    filesReport,
  };
}
// export for testing
exports.reconciliationReportForGranules = reconciliationReportForGranules;

/**
 * Compare the holdings in CMR with Cumulus' internal data store, report any discrepancies
 *
 * @param {Object} params .                        - parameters
 * @param {Object} params.bucketsConfig            - bucket configuration object
 * @param {Object} params.distributionBucketMap    - mapping of bucket->distirubtion path values
 *                                                 (e.g. { bucket: distribution path })
 * @param {NormalizedRecReportParams} params.recReportParams - Lambda endpoint's input params to
 *                                                     narrow focus of report
 * @returns {Promise<Object>}                      - a reconciliation report
 */
async function reconciliationReportForCumulusCMR(params) {
  log.info(`reconciliationReportForCumulusCMR with params ${JSON.stringify(params)}`);
  const knex = await getKnexClient();
  const { bucketsConfig, distributionBucketMap, recReportParams } = params;
  const collectionReport = await reconciliationReportForCollections(recReportParams, knex);
  const collectionsInCumulusCmr = {
    okCount: collectionReport.okCollections.length,
    onlyInCumulus: collectionReport.onlyInCumulus,
    onlyInCmr: collectionReport.onlyInCmr,
  };

  // create granule and granule file report for collections in both Cumulus and CMR
  const promisedGranuleReports = collectionReport.okCollections.map(
    (collectionId) => reconciliationReportForGranules({
      collectionId, bucketsConfig, distributionBucketMap, recReportParams, knex,
    })
  );
  const granuleAndFilesReports = await Promise.all(promisedGranuleReports);
  log.info('reconciliationReportForCumulusCMR: All Granule and Granule Files Reports completed. '
    + `${JSON.stringify(recReportParams)}`);

  const granulesInCumulusCmr = {};
  const filesInCumulusCmr = {};

  granulesInCumulusCmr.okCount = granuleAndFilesReports
    .reduce((accumulator, currentValue) => accumulator + currentValue.granulesReport.okCount, 0);
  granulesInCumulusCmr.onlyInCumulus = granuleAndFilesReports.reduce(
    (accumulator, currentValue) => accumulator.concat(currentValue.granulesReport.onlyInCumulus), []
  );
  granulesInCumulusCmr.onlyInCmr = granuleAndFilesReports.reduce(
    (accumulator, currentValue) => accumulator.concat(currentValue.granulesReport.onlyInCmr), []
  );

  filesInCumulusCmr.okCount = granuleAndFilesReports
    .reduce((accumulator, currentValue) => accumulator + currentValue.filesReport.okCount, 0);
  filesInCumulusCmr.onlyInCumulus = granuleAndFilesReports.reduce(
    (accumulator, currentValue) => accumulator.concat(currentValue.filesReport.onlyInCumulus), []
  );
  filesInCumulusCmr.onlyInCmr = granuleAndFilesReports.reduce(
    (accumulator, currentValue) => accumulator.concat(currentValue.filesReport.onlyInCmr), []
  );

  log.info('returning reconciliationReportForCumulusCMR');
  return { collectionsInCumulusCmr, granulesInCumulusCmr, filesInCumulusCmr };
}

/**
 * Write reconciliation report to S3
 * @param {Object} report       - report to upload
 * @param {string} systemBucket - system bucket
 * @param {string} reportKey    - report key
 * @returns {Promise}
 */
function _uploadReportToS3(report, systemBucket, reportKey) {
  return s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report, undefined, 2),
  });
}

/**
 * Create a Reconciliation report and save it to S3
 *
 * @param {NormalizedRecReportParams} recReportParams - params
 * @returns {Promise<null>} a Promise that resolves when the report has been
 *   uploaded to S3
 */
async function createReconciliationReport(recReportParams) {
  const {
    reportKey,
    stackName,
    systemBucket,
    location,
  } = recReportParams;
  log.info(`createReconciliationReport (${JSON.stringify(recReportParams)})`);
  // Fetch the bucket names to reconcile
  const bucketsConfigJson = await getJsonS3Object(systemBucket, getBucketsConfigKey(stackName));
  const distributionBucketMap = await fetchDistributionBucketMap(systemBucket, stackName);

  const dataBuckets = Object.values(bucketsConfigJson)
    .filter(isDataBucket).map((config) => config.name);

  const bucketsConfig = new BucketsConfig(bucketsConfigJson);

  // Write an initial report to S3
  /**
  * @type {Object}
  * @property {number} okCount
  * @property {Object<string, number>} okCountByGranule
  * @property {string[]} onlyInS3
  * @property {Object[]} [onlyInDb]
  */
  const filesInCumulus = {
    okCount: 0,
    okCountByGranule: {},
    onlyInS3: [],
    onlyInDb: [],
  };

  const reportFormatCumulusCmr = {
    okCount: 0,
    onlyInCumulus: [],
    onlyInCmr: [],
  };

  let report = {
    ...initialReportHeader(recReportParams),
    filesInCumulus,
    collectionsInCumulusCmr: cloneDeep(reportFormatCumulusCmr),
    granulesInCumulusCmr: cloneDeep(reportFormatCumulusCmr),
    filesInCumulusCmr: cloneDeep(reportFormatCumulusCmr),
  };

  try {
    await _uploadReportToS3(report, systemBucket, reportKey);

    // Internal consistency check S3 vs Cumulus DBs
    // --------------------------------------------
    if (location !== 'CMR') {
      // Create a report for each bucket

      const promisedBucketReports = dataBuckets.map(
        (bucket) => createReconciliationReportForBucket(bucket, recReportParams)
      );

      const bucketReports = await Promise.all(promisedBucketReports);
      log.info('bucketReports (S3 vs database) completed');

      bucketReports.forEach((bucketReport) => {
        report.filesInCumulus.okCount += bucketReport.okCount;
        report.filesInCumulus.onlyInS3 = report.filesInCumulus.onlyInS3.concat(
          bucketReport.onlyInS3
        );
        report.filesInCumulus.onlyInDb = report.filesInCumulus.onlyInDb.concat(
          bucketReport.onlyInDb
        );

        if (linkingFilesToGranules(recReportParams.reportType)) {
          Object.keys(bucketReport.okCountByGranule).forEach((granuleId) => {
            const currentGranuleCount = report.filesInCumulus.okCountByGranule[granuleId];
            const bucketGranuleCount = bucketReport.okCountByGranule[granuleId];

            report.filesInCumulus.okCountByGranule[granuleId] = (currentGranuleCount || 0)
              + bucketGranuleCount;
          });
        } else {
          delete report.filesInCumulus.okCountByGranule;
        }
      });
    }

    // compare the CUMULUS holdings with the holdings in CMR
    // -----------------------------------------------------
    if (location !== 'S3') {
      const cumulusCmrReport = await reconciliationReportForCumulusCMR({
        bucketsConfig, distributionBucketMap, recReportParams,
      });
      report = Object.assign(report, cumulusCmrReport);
    }
  } catch (error) {
    log.error(`Error caught in createReconciliationReport for reportKey ${reportKey}. ${error}`);
    log.info(`Writing report to S3: at ${systemBucket}/${reportKey}`);
    // Create the full report
    report.createEndTime = moment.utc().toISOString();
    report.status = 'Failed';
    report.error = error;

    // Write the full report to S3
    await _uploadReportToS3(report, systemBucket, reportKey);
    throw error;
  }
  log.info(`Writing report to S3: at ${systemBucket}/${reportKey}`);
  // Create the full report
  report.createEndTime = moment.utc().toISOString();
  report.status = 'SUCCESS';

  // Write the full report to S3
  return _uploadReportToS3(report, systemBucket, reportKey);
}

/**
 * start the report generation process and save the record to database
 * @param {Object} params - params
 * @param {string} params.systemBucket - the name of the CUMULUS system bucket
 * @param {string} params.stackName - the name of the CUMULUS stack
 * @param {string} params.reportType - the type of reconciliation report
 * @param {string} params.reportName - the name of the report
 * @param {Env} params.env - the environment variables
 * @param {Knex} params.knex - Optional Instance of a Knex client for testing
 * @param {EsClient} params.esClient - Optional Instance of an Elasticsearch client for testing
 * @returns {Promise<Object>} report record saved to the database
 */
async function processRequest(params) {
  log.info(`processing reconciliation report request with params: ${JSON.stringify(params)}`);
  const env = params.env ? params.env : process.env;
  const {
    reportType,
    reportName,
    systemBucket,
    stackName,
    knex = await getKnexClient({ env }),
    esClient = await getEsClient(),
  } = params;
  const createStartTime = moment.utc();
  const reportRecordName = reportName
    || `${camelCase(reportType)}Report-${createStartTime.format('YYYYMMDDTHHmmssSSS')}`;
  let reportKey = `${stackName}/reconciliation-reports/${filenamify(reportRecordName)}.json`;
  if (reportType === 'Granule Inventory') reportKey = reportKey.replace('.json', '.csv');

  // add request to database
  const reconciliationReportPgModel = new ReconciliationReportPgModel();
  const builtReportRecord = {
    name: reportRecordName,
    type: reportType,
    status: 'Pending',
    location: buildS3Uri(systemBucket, reportKey),
  };
  let [reportPgRecord] = await reconciliationReportPgModel.create(knex, builtReportRecord);
  let reportApiRecord = translatePostgresReconReportToApiReconReport(reportPgRecord);
  await indexReconciliationReport(esClient, reportApiRecord, process.env.ES_INDEX);
  log.info(`Report added to database as pending: ${JSON.stringify(reportApiRecord)}.`);

  const concurrency = env.CONCURRENCY || '3';

  try {
    /** @type NormalizedRecReportParams */
    const recReportParams = {
      ...params,
      createStartTime,
      reportKey,
      reportType,
      knex,
      concurrency,
    };
    log.info(`Beginning ${reportType} report with params: ${JSON.stringify(recReportParams)}`);
    if (reportType === 'Internal') {
      log.error(
        'Internal Reconciliation Reports are no longer valid, as Cumulus is no longer utilizing Elasticsearch'
      );
      //TODO remove internal rec report code
      throw new Error('Internal Reconciliation Reports are no longer valid');
    } else if (reportType === 'Granule Inventory') {
      await createGranuleInventoryReport(recReportParams);
    } else if (reportType === 'ORCA Backup') {
      await createOrcaBackupReconciliationReport(recReportParams);
    } else if (['Inventory', 'Granule Not Found'].includes(reportType)) {
      // reportType is in ['Inventory', 'Granule Not Found']
      await createReconciliationReport(recReportParams);
    } else {
      // TODO make this a better error (res.boom?)
      throw new Error(`Invalid report type: ${reportType}`);
    }

    const generatedRecord = {
      ...reportPgRecord,
      status: 'Generated',
    };
    [reportPgRecord] = await reconciliationReportPgModel.upsert(knex, generatedRecord);
    reportApiRecord = translatePostgresReconReportToApiReconReport(reportPgRecord);
    await indexReconciliationReport(esClient, reportApiRecord, process.env.ES_INDEX);
  } catch (error) {
    log.error(`Error caught in createReconciliationReport creating ${reportType} report ${reportRecordName}. ${error}`); // eslint-disable-line max-len
    const erroredRecord = {
      ...reportPgRecord,
      status: 'Failed',
      error: {
        Error: error.message,
        Cause: errorify(error),
      },
    };
    [reportPgRecord] = await reconciliationReportPgModel.upsert(knex, erroredRecord);
    reportApiRecord = translatePostgresReconReportToApiReconReport(reportPgRecord);
    await indexReconciliationReport(
      esClient,
      reportApiRecord,
      process.env.ES_INDEX
    );
    throw error;
  }

  reportPgRecord = await reconciliationReportPgModel.get(knex, { name: builtReportRecord.name });
  return translatePostgresReconReportToApiReconReport(reportPgRecord);
}

async function handler(event) {
  // increase the limit of search result from CMR.searchCollections/searchGranules
  process.env.CMR_LIMIT = process.env.CMR_LIMIT || '5000';
  process.env.CMR_PAGE_SIZE = process.env.CMR_PAGE_SIZE || '200';

  //TODO: Remove irrelevant env vars from terraform after ES reports are removed
  const varsToLog = ['CMR_LIMIT', 'CMR_PAGE_SIZE', 'ES_SCROLL', 'ES_SCROLL_SIZE'];
  const envsToLog = pickBy(process.env, (value, key) => varsToLog.includes(key));
  log.info(`CMR and ES Environment variables: ${JSON.stringify(envsToLog)}`);

  return await processRequest(event);
}
exports.handler = handler;
