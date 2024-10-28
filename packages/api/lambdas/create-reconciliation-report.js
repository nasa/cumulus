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
} = require('@cumulus/db');
const { ESCollectionGranuleQueue } = require('@cumulus/es-client/esCollectionGranuleQueue');
const Collection = require('@cumulus/es-client/collections');
const { ESSearchQueue } = require('@cumulus/es-client/esSearchQueue');
const { indexReconciliationReport } = require('@cumulus/es-client/indexer');
const { getEsClient } = require('@cumulus/es-client/search');
const Logger = require('@cumulus/logger');

const { createInternalReconciliationReport } = require('./internal-reconciliation-report');
const { createGranuleInventoryReport } = require('./reports/granule-inventory-report');
const { createOrcaBackupReconciliationReport } = require('./reports/orca-backup-reconciliation-report');
const { ReconciliationReport } = require('../models');
const { errorify, filenamify } = require('../lib/utils');
const {
  cmrGranuleSearchParams,
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParams,
  initialReportHeader,
} = require('../lib/reconciliationReport');

const log = new Logger({ sender: '@api/lambdas/create-reconciliation-report' });

const isDataBucket = (bucketConfig) => ['private', 'public', 'protected'].includes(bucketConfig.type);

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
 * Checks to see if the searchParams have any value that would require a
 * filtered search in ES
 * @param {Object} searchParams
 * @returns {boolean} returns true if searchParams contain a key that causes filtering to occur.
 */
function shouldAggregateGranulesForCollections(searchParams) {
  return [
    'updatedAt__from',
    'updatedAt__to',
    'granuleId__in',
    'provider__in',
  ].some((e) => !!searchParams[e]);
}

/**
 * fetch CMR collections and filter the returned UMM CMR collections by the desired collectionIds
 *
 * @param {Object} recReportParams - input report params
 * @param {Array<string>} recReportParams.collectionIds - array of collectionIds to keep
 * @returns {Array<string>} filtered list of collectionIds returned from CMR
 */
async function fetchCMRCollections({ collectionIds }) {
  const cmrSettings = await getCmrSettings();
  const cmrCollectionsIterator = new CMRSearchConceptQueue({
    cmrSettings,
    type: 'collections',
    format: 'umm_json',
  });

  const allCmrCollectionIds = [];
  let nextCmrItem = await cmrCollectionsIterator.shift();
  while (nextCmrItem) {
    allCmrCollectionIds
      .push(constructCollectionId(nextCmrItem.umm.ShortName, nextCmrItem.umm.Version));
    nextCmrItem = await cmrCollectionsIterator.shift(); // eslint-disable-line no-await-in-loop
  }

  const cmrCollectionIds = allCmrCollectionIds.sort();

  if (!collectionIds) return cmrCollectionIds;
  return cmrCollectionIds.filter((item) => collectionIds.includes(item));
}

/**
 * Fetch collections in Elasticsearch.
 * @param {Object} recReportParams - input report params.
 * @returns {Promise<Array>} - list of collectionIds that match input paramaters
 */
async function fetchESCollections(recReportParams) {
  const esCollectionSearchParams = convertToESCollectionSearchParams(recReportParams);
  const esGranuleSearchParams = convertToESGranuleSearchParams(recReportParams);
  let esCollectionIds;
  // [MHS, 09/02/2020] We are doing these two because we can't use
  // aggregations on scrolls yet until we update elasticsearch version.
  if (shouldAggregateGranulesForCollections(esGranuleSearchParams)) {
    // Build an ESCollection and call the aggregateGranuleCollections to
    // get list of collection ids that have granules that have been updated
    const esCollection = new Collection({ queryStringParameters: esGranuleSearchParams }, 'collection', process.env.ES_INDEX);
    const esCollectionItems = await esCollection.aggregateGranuleCollections();
    esCollectionIds = esCollectionItems.sort();
  } else {
    // return all ES collections
    const esCollection = new ESSearchQueue(esCollectionSearchParams, 'collection', process.env.ES_INDEX);
    const esCollectionItems = await esCollection.empty();
    esCollectionIds = esCollectionItems.map(
      (item) => constructCollectionId(item.name, item.version)
    ).sort();
  }
  return esCollectionIds;
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
    providers: recReportParams.providers,
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
 * @param {Object} recReportParams - lambda's input filtering parameters to
 *                                   narrow limit of report.
 * @returns {Promise<Object>} an object with the okCollections, onlyInCumulus and
 * onlyInCmr
 */
async function reconciliationReportForCollections(recReportParams) {
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
    const cmrCollectionIds = await fetchCMRCollections(recReportParams);
    const esCollectionIds = await fetchESCollections(recReportParams);
    log.info(`Comparing ${cmrCollectionIds.length} CMR collections to ${esCollectionIds.length} Elasticsearch collections`);

    let nextDbCollectionId = esCollectionIds[0];
    let nextCmrCollectionId = cmrCollectionIds[0];

    while (nextDbCollectionId && nextCmrCollectionId) {
      if (nextDbCollectionId < nextCmrCollectionId) {
        // Found an item that is only in Cumulus database and not in cmr
        esCollectionIds.shift();
        collectionsOnlyInCumulus.push(nextDbCollectionId);
      } else if (nextDbCollectionId > nextCmrCollectionId) {
        // Found an item that is only in cmr and not in Cumulus database
        if (!oneWayReport) collectionsOnlyInCmr.push(nextCmrCollectionId);
        cmrCollectionIds.shift();
      } else {
        // Found an item that is in both cmr and database
        okCollections.push(nextDbCollectionId);
        esCollectionIds.shift();
        cmrCollectionIds.shift();
      }

      nextDbCollectionId = (esCollectionIds.length !== 0) ? esCollectionIds[0] : undefined;
      nextCmrCollectionId = (cmrCollectionIds.length !== 0) ? cmrCollectionIds[0] : undefined;
    }

    // Add any remaining database items to the report
    collectionsOnlyInCumulus = collectionsOnlyInCumulus.concat(esCollectionIds);

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
            distEndpoint: process.env.DISTRIBUTION_ENDPOINT,
            bucketTypes,
            urlType: 'distribution',
            distributionBucketMap,
          });

          const s3AccessUrl = await constructOnlineAccessUrl({
            file: granuleFiles[urlFileName],
            distEndpoint: process.env.DISTRIBUTION_ENDPOINT,
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
 * @param {Object} params                        - parameters
 * @param {string} params.collectionId           - the collection which has the granules to be
 *                                                 reconciled
 * @param {Object} params.bucketsConfig          - bucket configuration object
 * @param {Object} params.distributionBucketMap  - mapping of bucket->distirubtion path values
 *                                                 (e.g. { bucket: distribution path })
 * @param {Object} params.recReportParams        - Lambda report paramaters for narrowing focus
 * @returns {Promise<Object>}                    - an object with the granulesReport and filesReport
 */
async function reconciliationReportForGranules(params) {
  // compare granule holdings:
  //   Get CMR granules list (by PROVIDER, short_name, version, sort_key: ['granule_ur'])
  //   Get CUMULUS granules list (by collectionId order by granuleId)
  //   Report granules only in CMR
  //   Report granules only in CUMULUS
  log.info(`reconciliationReportForGranules(${params.collectionId})`);
  const { collectionId, bucketsConfig, distributionBucketMap, recReportParams } = params;
  const { name, version } = deconstructCollectionId(collectionId);
  const granulesReport = { okCount: 0, onlyInCumulus: [], onlyInCmr: [] };
  const filesReport = { okCount: 0, onlyInCumulus: [], onlyInCmr: [] };
  try {
    const cmrSettings = await getCmrSettings();
    const searchParams = new URLSearchParams({ short_name: name, version: version, sort_key: ['granule_ur'] });
    cmrGranuleSearchParams(recReportParams).forEach(([paramName, paramValue]) => {
      searchParams.append(paramName, paramValue);
    });

    log.debug(`fetch CMRSearchConceptQueue(${collectionId}) with searchParams: ${JSON.stringify(searchParams)}`);
    const cmrGranulesIterator = new CMRSearchConceptQueue({
      cmrSettings,
      type: 'granules',
      searchParams,
      format: 'umm_json',
    });

    const esGranuleSearchParamsByCollectionId = convertToESGranuleSearchParams(
      { ...recReportParams, collectionIds: [collectionId] }
    );

    log.debug(`Create ES granule iterator with ${JSON.stringify(esGranuleSearchParamsByCollectionId)}`);
    const esGranulesIterator = new ESCollectionGranuleQueue(
      esGranuleSearchParamsByCollectionId, process.env.ES_INDEX
    );
    const oneWay = isOneWayGranuleReport(recReportParams);
    log.debug(`is oneWay granule report: ${collectionId}, ${oneWay}`);

    let [nextDbItem, nextCmrItem] = await Promise.all(
      [esGranulesIterator.peek(), cmrGranulesIterator.peek()]
    );

    while (nextDbItem && nextCmrItem) {
      const nextDbGranuleId = nextDbItem.granuleId;
      const nextCmrGranuleId = nextCmrItem.umm.GranuleUR;

      if (nextDbGranuleId < nextCmrGranuleId) {
        // Found an item that is only in Cumulus database and not in CMR
        granulesReport.onlyInCumulus.push({
          granuleId: nextDbGranuleId,
          collectionId: collectionId,
        });
        await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
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
        const granuleInDb = {
          granuleId: nextDbGranuleId,
          collectionId: collectionId,
          files: nextDbItem.files,
        };
        const granuleInCmr = {
          GranuleUR: nextCmrGranuleId,
          ShortName: nextCmrItem.umm.CollectionReference.ShortName,
          Version: nextCmrItem.umm.CollectionReference.Version,
          RelatedUrls: nextCmrItem.umm.RelatedUrls,
        };
        await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
        await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop

        // compare the files now to avoid keeping the granules' information in memory
        // eslint-disable-next-line no-await-in-loop
        const fileReport = await reconciliationReportForGranuleFiles({
          granuleInDb, granuleInCmr, bucketsConfig, distributionBucketMap,
        });
        filesReport.okCount += fileReport.okCount;
        filesReport.onlyInCumulus = filesReport.onlyInCumulus.concat(fileReport.onlyInCumulus);
        filesReport.onlyInCmr = filesReport.onlyInCmr.concat(fileReport.onlyInCmr);
      }

      [nextDbItem, nextCmrItem] = await Promise.all([esGranulesIterator.peek(), cmrGranulesIterator.peek()]); // eslint-disable-line max-len, no-await-in-loop
    }

    // Add any remaining ES/PostgreSQL items to the report
    while (await esGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
      const dbItem = await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      granulesReport.onlyInCumulus.push({
        granuleId: dbItem.granuleId,
        collectionId: collectionId,
      });
    }

    // Add any remaining CMR items to the report
    if (!oneWay) {
      while (await cmrGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
        const cmrItem = await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
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
 * @param {Object} params .                      - parameters
 * @param {Object} params.bucketsConfig          - bucket configuration object
 * @param {Object} params.distributionBucketMap  - mapping of bucket->distirubtion path values
 *                                                 (e.g. { bucket: distribution path })
 * @param {Object} [params.recReportParams]      - optional Lambda endpoint's input params to
 *                                                 narrow report focus
 * @param {number} [params.recReportParams.StartTimestamp]
 * @param {number} [params.recReportParams.EndTimestamp]
 * @param {string} [params.recReportparams.collectionIds]
 * @returns {Promise<Object>}                    - a reconciliation report
 */
async function reconciliationReportForCumulusCMR(params) {
  log.info(`reconciliationReportForCumulusCMR with params ${JSON.stringify(params)}`);
  const { bucketsConfig, distributionBucketMap, recReportParams } = params;
  const collectionReport = await reconciliationReportForCollections(recReportParams);
  const collectionsInCumulusCmr = {
    okCount: collectionReport.okCollections.length,
    onlyInCumulus: collectionReport.onlyInCumulus,
    onlyInCmr: collectionReport.onlyInCmr,
  };

  // create granule and granule file report for collections in both Cumulus and CMR
  const promisedGranuleReports = collectionReport.okCollections.map(
    (collectionId) => reconciliationReportForGranules({
      collectionId, bucketsConfig, distributionBucketMap, recReportParams,
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
 * @returns {Promise<null>}
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
 * @param {Object} recReportParams - params
 * @param {Object} recReportParams.reportType - the report type
 * @param {moment} recReportParams.createStartTime - when the report creation was begun
 * @param {moment} recReportParams.endTimestamp - ending report datetime ISO Timestamp
 * @param {string} recReportParams.location - location to inventory for report
 * @param {string} recReportParams.reportKey - the s3 report key
 * @param {string} recReportParams.stackName - the name of the CUMULUS stack
 * @param {moment} recReportParams.startTimestamp - beginning report datetime ISO timestamp
 * @param {string} recReportParams.systemBucket - the name of the CUMULUS system bucket
 * @param {Knex} recReportParams.knex - Database client for interacting with PostgreSQL database
 * @returns {Promise<null>} a Promise that resolves when the report has been
 *   uploaded to S3
 */
async function createReconciliationReport(recReportParams) {
  const {
    reportKey,
    stackName,
    systemBucket,
    location,
    knex,
  } = recReportParams;
  log.info(`createReconciliationReport (${JSON.stringify(recReportParams)})`);
  // Fetch the bucket names to reconcile
  const bucketsConfigJson = await getJsonS3Object(systemBucket, getBucketsConfigKey(stackName));
  const distributionBucketMap = await fetchDistributionBucketMap(systemBucket, stackName);

  const dataBuckets = Object.values(bucketsConfigJson)
    .filter(isDataBucket).map((config) => config.name);

  const bucketsConfig = new BucketsConfig(bucketsConfigJson);

  // Write an initial report to S3
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
        (bucket) => createReconciliationReportForBucket(bucket, recReportParams, knex)
      );

      const bucketReports = await Promise.all(promisedBucketReports);
      log.info('bucketReports (S3 vs database) completed');

      bucketReports.forEach((bucketReport) => {
        report.filesInCumulus.okCount += bucketReport.okCount;
        report.filesInCumulus.onlyInS3 = report.filesInCumulus.onlyInS3.concat(bucketReport.onlyInS3); // eslint-disable-line max-len
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
 * @param {Knex} params.knex - Optional Instance of a Knex client for testing
 * @returns {Object} report record saved to the database
 */
async function processRequest(params) {
  log.info(`processing reconciliation report request with params: ${JSON.stringify(params)}`);
  const env = params.env ? params.env : process.env;
  const {
    reportType,
    reportName,
    systemBucket,
    stackName,
    esClient = await getEsClient(),
    knex = await getKnexClient(env),
  } = params;
  const createStartTime = moment.utc();
  const reportRecordName = reportName
    || `${camelCase(reportType)}Report-${createStartTime.format('YYYYMMDDTHHmmssSSS')}`;
  let reportKey = `${stackName}/reconciliation-reports/${filenamify(reportRecordName)}.json`;
  if (reportType === 'Granule Inventory') reportKey = reportKey.replace('.json', '.csv');

  // add request to database
  const reconciliationReportModel = new ReconciliationReport();
  const reportRecord = {
    name: reportRecordName,
    type: reportType,
    status: 'Pending',
    location: buildS3Uri(systemBucket, reportKey),
  };
  let apiRecord = await reconciliationReportModel.create(reportRecord);
  await indexReconciliationReport(esClient, apiRecord, process.env.ES_INDEX);
  log.info(`Report added to database as pending: ${JSON.stringify(apiRecord)}.`);

  const concurrency = env.CONCURRENCY || 3;

  try {
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
      await createInternalReconciliationReport(recReportParams);
    } else if (reportType === 'Granule Inventory') {
      await createGranuleInventoryReport(recReportParams);
    } else if (reportType === 'ORCA Backup') {
      await createOrcaBackupReconciliationReport(recReportParams);
    } else {
      // reportType is in ['Inventory', 'Granule Not Found']
      await createReconciliationReport(recReportParams);
    }
    apiRecord = await reconciliationReportModel.updateStatus({ name: reportRecord.name }, 'Generated');
    await indexReconciliationReport(esClient, { ...apiRecord, status: 'Generated' }, process.env.ES_INDEX);
  } catch (error) {
    log.error(`Error caught in createReconciliationReport creating ${reportType} report ${reportRecordName}. ${error}`);
    const updates = {
      status: 'Failed',
      error: {
        Error: error.message,
        Cause: errorify(error),
      },
    };
    apiRecord = await reconciliationReportModel.update({ name: reportRecord.name }, updates);
    await indexReconciliationReport(
      esClient,
      { ...apiRecord, ...updates },
      process.env.ES_INDEX
    );
    throw error;
  }

  return reconciliationReportModel.get({ name: reportRecord.name });
}

async function handler(event) {
  // increase the limit of search result from CMR.searchCollections/searchGranules
  process.env.CMR_LIMIT = process.env.CMR_LIMIT || 5000;
  process.env.CMR_PAGE_SIZE = process.env.CMR_PAGE_SIZE || 200;

  const varsToLog = ['CMR_LIMIT', 'CMR_PAGE_SIZE', 'ES_SCROLL', 'ES_SCROLL_SIZE'];
  const envsToLog = pickBy(process.env, (value, key) => varsToLog.includes(key));
  log.info(`CMR and ES Environment variables: ${JSON.stringify(envsToLog)}`);

  return await processRequest(event);
}
exports.handler = handler;
