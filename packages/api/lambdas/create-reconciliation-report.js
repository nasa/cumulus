'use strict';

const cloneDeep = require('lodash/cloneDeep');
const keyBy = require('lodash/keyBy');
const moment = require('moment');
const DynamoDbSearchQueue = require('@cumulus/aws-client/DynamoDbSearchQueue');
const { buildS3Uri, getJsonS3Object } = require('@cumulus/aws-client/S3');
const S3ListObjectsV2Queue = require('@cumulus/aws-client/S3ListObjectsV2Queue');
const { s3 } = require('@cumulus/aws-client/services');
const BucketsConfig = require('@cumulus/common/BucketsConfig');
const Logger = require('@cumulus/logger');
const { getBucketsConfigKey, getDistributionBucketMapKey } = require('@cumulus/common/stack');
const { constructCollectionId } = require('@cumulus/message/Collections');

const CMR = require('@cumulus/cmr-client/CMR');
const CMRSearchConceptQueue = require('@cumulus/cmr-client/CMRSearchConceptQueue');
const { constructOnlineAccessUrl, getCmrSettings } = require('@cumulus/cmrjs/cmr-utils');

const GranuleFilesCache = require('../lib/GranuleFilesCache');
const { ESCollectionGranuleQueue } = require('../es/esCollectionGranuleQueue');
const { ReconciliationReport } = require('../models');
const { deconstructCollectionId, errorify } = require('../lib/utils');
const Collection = require('../es/collections');

const log = new Logger({ sender: '@api/lambdas/create-reconciliation-report' });

const isDataBucket = (bucketConfig) => ['private', 'public', 'protected'].includes(bucketConfig.type);

/**
 * return the queue of the files for a given bucket,
 * the items should be ordered by the range key which is the bucket 'key' attribute
 *
 * @param {string} bucket - bucket name
 * @returns {Array<Object>} the files' queue for a given bucket
 */
const createSearchQueueForBucket = (bucket) => new DynamoDbSearchQueue(
  {
    TableName: GranuleFilesCache.cacheTableName(),
    ExpressionAttributeNames: { '#b': 'bucket' },
    ExpressionAttributeValues: { ':bucket': bucket },
    FilterExpression: '#b = :bucket'
  },
  'scan'
);

/**
 * @param {string} datestring - ISO timestamp string
 * @returns {number} - primitive value of input date.
 */
function ISODateToValue(datestring) {
  const primitiveDate = (new Date(datestring)).valueOf();
  return !Number.isNaN(primitiveDate) ? primitiveDate : undefined;
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for CMR Collection search.
 */
function convertToCMRCollectionSearchParams(params) {
  const startDate = params.startTimestamp || '';
  const endDate = params.endTimestamp || '';
  return {
    'has_granules_revised_at[]': `${startDate},${endDate}`
  };
}

/**
 *
 * @param {Object} params - request params to convert to reconciliationReportForCollection params
 * @returns {Object} object of desired parameters formated for Elasticsearch.
 */
function convertToESCollectionSearchParams(params) {
  return {
    updatedAt__from: ISODateToValue(params.startTimestamp),
    updatedAt__to: ISODateToValue(params.endTimestamp)
  };
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for Elasticsearch.
 */
function convertToESSearchParams(params) {
  return {
    timestamp__from: ISODateToValue(params.startTimestamp),
    timestamp__to: ISODateToValue(params.endTimestamp)
  };
}

/**
 *
 * @param {Object} params - request params to convert to bucket filter params
 * @returns {Object} desired parameters formated for bucket reconcilation
 *                   report filtering.
 */
function convertToBucketReportFilterParams(params) {
  return {
    startDateTime: ISODateToValue(params.startTimestamp),
    endDateTime: ISODateToValue(params.endTimestamp)
  };
}

/**
 * Checks to see if any of the included reportParams contains a value that
 * would turn a Cumulus Vs CMR comparison into a one way report.
 *
 * @param {Object} reportParams
 * @returns {boolean} Returns true only if a tested key exists on the input
 *                    object and the key references a defined value.
 */
function isOneWayReport(reportParams) {
  return [
    'startTimestamp',
    'endTimestamp'
  ].some((e) => !!reportParams[e]);
}

/**
 * Verify that all objects in an S3 bucket contain corresponding entries in
 * DynamoDB, and that there are no extras in either S3 or DynamoDB
 *
 * @param {string} Bucket - the bucket containing files to be reconciled
 (TODO [MHS, 08/07/2020] for future use)
 * @param {Object} _bucketReportParams - bucket Filter information.
 * @returns {Promise<Object>} a report
 */
async function createReconciliationReportForBucket(Bucket, _bucketReportParams = {}) {
  const s3ObjectsQueue = new S3ListObjectsV2Queue({ Bucket });
  const dynamoDbFilesLister = createSearchQueueForBucket(Bucket);

  let okCount = 0;
  const onlyInS3 = [];
  const onlyInDynamoDb = [];

  let [nextS3Object, nextDynamoDbItem] = await Promise.all([s3ObjectsQueue.peek(), dynamoDbFilesLister.peek()]); // eslint-disable-line max-len
  while (nextS3Object && nextDynamoDbItem) {
    const nextS3Uri = buildS3Uri(Bucket, nextS3Object.Key);
    const nextDynamoDbUri = buildS3Uri(Bucket, nextDynamoDbItem.key);

    if (nextS3Uri < nextDynamoDbUri) {
      // Found an item that is only in S3 and not in DynamoDB
      onlyInS3.push(nextS3Uri);
      s3ObjectsQueue.shift();
    } else if (nextS3Uri > nextDynamoDbUri) {
      // Found an item that is only in DynamoDB and not in S3
      const dynamoDbItem = await dynamoDbFilesLister.shift(); // eslint-disable-line no-await-in-loop, max-len
      onlyInDynamoDb.push({
        uri: buildS3Uri(Bucket, dynamoDbItem.key),
        granuleId: dynamoDbItem.granuleId
      });
    } else {
      // Found an item that is in both S3 and DynamoDB
      okCount += 1;
      s3ObjectsQueue.shift();
      dynamoDbFilesLister.shift();
    }

    [nextS3Object, nextDynamoDbItem] = await Promise.all([s3ObjectsQueue.peek(), dynamoDbFilesLister.peek()]); // eslint-disable-line max-len, no-await-in-loop
  }

  // Add any remaining S3 items to the report
  while (await s3ObjectsQueue.peek()) { // eslint-disable-line no-await-in-loop
    const s3Object = await s3ObjectsQueue.shift(); // eslint-disable-line no-await-in-loop
    onlyInS3.push(buildS3Uri(Bucket, s3Object.Key));
  }

  // Add any remaining DynamoDB items to the report
  while (await dynamoDbFilesLister.peek()) { // eslint-disable-line no-await-in-loop
    const dynamoDbItem = await dynamoDbFilesLister.shift(); // eslint-disable-line no-await-in-loop
    onlyInDynamoDb.push({
      uri: buildS3Uri(Bucket, dynamoDbItem.key),
      granuleId: dynamoDbItem.granuleId
    });
  }

  return {
    okCount,
    onlyInS3,
    onlyInDynamoDb
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

  const oneWayReport = isOneWayReport(recReportParams);
  log.info(`is OneWay: ${oneWayReport}`);

  // get all collections from CMR and sort them, since CMR query doesn't support
  // 'Version' as sort_key
  const cmrSettings = await getCmrSettings();
  const cmr = new CMR(cmrSettings);
  const cmrSearchParams = convertToCMRCollectionSearchParams(recReportParams);
  log.info(`cmrSearchParams: ${JSON.stringify(cmrSearchParams)}`);
  const cmrCollectionItems = await cmr.searchCollections(cmrSearchParams, 'umm_json');

  const cmrCollectionIds = cmrCollectionItems.map((item) =>
    constructCollectionId(item.umm.ShortName, item.umm.Version)).sort();

  log.info(`CMR Collection Ids: ${JSON.stringify(cmrCollectionIds)}`);
  // Build a ESCollection and call the aggregateActiveGranuleCollections to get
  // list of Active CollectionIds
  const esCollectionSearchParams = convertToESCollectionSearchParams(recReportParams);
  const esCollection = new Collection({ queryStringParameters: esCollectionSearchParams }, 'collection', process.env.ES_INDEX);
  const esCollectionItems = await esCollection.aggregateActiveGranuleCollections();
  const esCollectionIds = esCollectionItems.sort();
  log.info(`esCollectionIds: ${JSON.stringify(esCollectionIds)}`);
  log.info(`esCollectionSearchParams: ${JSON.stringify(esCollectionSearchParams)}`);

  const okCollections = [];
  let collectionsOnlyInCumulus = [];
  let collectionsOnlyInCmr = [];

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

  return {
    okCollections,
    onlyInCumulus: collectionsOnlyInCumulus,
    onlyInCmr: collectionsOnlyInCmr
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

  const granuleFiles = keyBy(granuleInDb.files, 'fileName');

  // URL types for downloading granule files
  const cmrGetDataTypes = ['GET DATA', 'GET RELATED VISUALIZATION'];
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
          cmrGranuleUrlType: 'distribution',
          distributionBucketMap
        });

        const s3AccessUrl = await constructOnlineAccessUrl({
          file: granuleFiles[urlFileName],
          distEndpoint: process.env.DISTRIBUTION_ENDPOINT,
          bucketTypes,
          cmrGranuleUrlType: 's3',
          distributionBucketMap
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
            GranuleUR: granuleInCmr.GranuleUR
          });
        }

        delete granuleFiles[urlFileName];
      } else if (cmrGetDataTypes.includes(relatedUrl.Type)) {
        // no matching database file, only in CMR
        onlyInCmr.push({
          URL: relatedUrl.URL,
          Type: relatedUrl.Type,
          GranuleUR: granuleInCmr.GranuleUR
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
      onlyInCumulus.push({
        fileName: fileName,
        uri: buildS3Uri(granuleFiles[fileName].bucket, granuleFiles[fileName].key),
        granuleId: granuleInDb.granuleId
      });
    }
  });
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
  const { collectionId, bucketsConfig, distributionBucketMap, recReportParams } = params;
  const { name, version } = deconstructCollectionId(collectionId);

  const cmrSettings = await getCmrSettings();
  const cmrGranulesIterator = new CMRSearchConceptQueue({
    cmrSettings,
    type: 'granules',
    searchParams: { short_name: name, version: version, sort_key: ['granule_ur'] },
    format: 'umm_json'
  });

  const esCollectionSearchParams = { ...convertToESSearchParams(recReportParams), collectionId };
  const esGranulesIterator = new ESCollectionGranuleQueue(esCollectionSearchParams, process.env.ES_INDEX);
  const oneWay = isOneWayReport(recReportParams);
  const granulesReport = {
    okCount: 0,
    onlyInCumulus: [],
    onlyInCmr: []
  };

  const filesReport = {
    okCount: 0,
    onlyInCumulus: [],
    onlyInCmr: []
  };

  let [nextDbItem, nextCmrItem] = await Promise.all([esGranulesIterator.peek(), cmrGranulesIterator.peek()]); // eslint-disable-line max-len

  while (nextDbItem && nextCmrItem) {
    const nextDbGranuleId = nextDbItem.granuleId;
    const nextCmrGranuleId = nextCmrItem.umm.GranuleUR;

    if (nextDbGranuleId < nextCmrGranuleId) {
      // Found an item that is only in Cumulus database and not in CMR
      granulesReport.onlyInCumulus.push({
        granuleId: nextDbGranuleId,
        collectionId: collectionId
      });
      await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
    } else if (nextDbGranuleId > nextCmrGranuleId) {
      // Found an item that is only in CMR and not in Cumulus database
      if (!oneWay) {
        granulesReport.onlyInCmr.push({
          GranuleUR: nextCmrGranuleId,
          ShortName: nextCmrItem.umm.CollectionReference.ShortName,
          Version: nextCmrItem.umm.CollectionReference.Version
        });
      }
      await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
    } else {
      // Found an item that is in both CMR and Cumulus database
      granulesReport.okCount += 1;
      const granuleInDb = {
        granuleId: nextDbGranuleId,
        collectionId: collectionId,
        files: nextDbItem.files
      };
      const granuleInCmr = {
        GranuleUR: nextCmrGranuleId,
        ShortName: nextCmrItem.umm.CollectionReference.ShortName,
        Version: nextCmrItem.umm.CollectionReference.Version,
        RelatedUrls: nextCmrItem.umm.RelatedUrls
      };
      await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop

      // compare the files now to avoid keeping the granules' information in memory
      // eslint-disable-next-line no-await-in-loop
      const fileReport = await reconciliationReportForGranuleFiles({
        granuleInDb, granuleInCmr, bucketsConfig, distributionBucketMap
      });
      filesReport.okCount += fileReport.okCount;
      filesReport.onlyInCumulus = filesReport.onlyInCumulus.concat(fileReport.onlyInCumulus);
      filesReport.onlyInCmr = filesReport.onlyInCmr.concat(fileReport.onlyInCmr);
    }

    [nextDbItem, nextCmrItem] = await Promise.all([esGranulesIterator.peek(), cmrGranulesIterator.peek()]); // eslint-disable-line max-len, no-await-in-loop
  }

  // Add any remaining DynamoDB items to the report
  while (await esGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
    const dbItem = await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
    granulesReport.onlyInCumulus.push({
      granuleId: dbItem.granuleId,
      collectionId: collectionId
    });
  }

  // Add any remaining CMR items to the report
  if (!oneWay) {
    while (await cmrGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
      const cmrItem = await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      granulesReport.onlyInCmr.push({
        GranuleUR: cmrItem.umm.GranuleUR,
        ShortName: nextCmrItem.umm.CollectionReference.ShortName,
        Version: nextCmrItem.umm.CollectionReference.Version
      });
    }
  }

  return {
    granulesReport,
    filesReport
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
 * @param {Object} params.recReportParams         - optional Lambda endpoint's input params to narrow report focus
 * @param {number} params.recReportParams.StartTimestamp
 * @param {number} params.recReportParams.EndTimestamp
 * @returns {Promise<Object>}                    - a Endciliation report
 */
async function reconciliationReportForCumulusCMR(params) {
  const { bucketsConfig, distributionBucketMap, recReportParams } = params;
  const collectionReport = await reconciliationReportForCollections(recReportParams);
  const collectionsInCumulusCmr = {
    okCount: collectionReport.okCollections.length,
    onlyInCumulus: collectionReport.onlyInCumulus,
    onlyInCmr: collectionReport.onlyInCmr
  };

  // create granule and granule file report for collections in both Cumulus and CMR
  const promisedGranuleReports = collectionReport.okCollections.map(
    (collectionId) => reconciliationReportForGranules({
      collectionId, bucketsConfig, distributionBucketMap, recReportParams
    })
  );
  const granuleAndFilesReports = await Promise.all(promisedGranuleReports);

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

  return { collectionsInCumulusCmr, granulesInCumulusCmr, filesInCumulusCmr };
}

/**
 * Create a Reconciliation report and save it to S3
 *
 * @param {Object} recReportParams - params
 * @param {moment} recReportParams.createStartTime - when the report creation was begun
 * @param {moment} recReportParams.endTimestamp - ending report datetime ISO Timestamp
 * @param {string} recReportParams.reportKey - the s3 report key
 * @param {string} recReportParams.stackName - the name of the CUMULUS stack
 * @param {moment} recReportParams.startTimestamp - beginning report datetime ISO timestamp
 * @param {string} recReportParams.systemBucket - the name of the CUMULUS system bucket
 * @returns {Promise<null>} a Promise that resolves when the report has been
 *   uploaded to S3
 */
async function createReconciliationReport(recReportParams) {
  const {
    createStartTime,
    endTimestamp,
    reportKey,
    stackName,
    startTimestamp,
    systemBucket
  } = recReportParams;

  // Fetch the bucket names to reconcile
  const bucketsConfigJson = await getJsonS3Object(systemBucket, getBucketsConfigKey(stackName));
  const distributionBucketMap = await getJsonS3Object(
    systemBucket, getDistributionBucketMapKey(stackName)
  );

  const dataBuckets = Object.values(bucketsConfigJson)
    .filter(isDataBucket).map((config) => config.name);

  const bucketsConfig = new BucketsConfig(bucketsConfigJson);

  // Write an initial report to S3
  const filesInCumulus = {
    okCount: 0,
    onlyInS3: [],
    onlyInDynamoDb: []
  };

  const reportFormatCumulusCmr = {
    okCount: 0,
    onlyInCumulus: [],
    onlyInCmr: []
  };

  let report = {
    createStartTime: createStartTime.toISOString(),
    createEndTime: undefined,
    reportStartTime: startTimestamp,
    reportEndTime: endTimestamp,
    status: 'RUNNING',
    error: undefined,
    filesInCumulus,
    collectionsInCumulusCmr: cloneDeep(reportFormatCumulusCmr),
    granulesInCumulusCmr: cloneDeep(reportFormatCumulusCmr),
    filesInCumulusCmr: cloneDeep(reportFormatCumulusCmr)
  };

  await s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report)
  }).promise();

  // Internal consistency check S3 vs Cumulus DBs
  // --------------------------------------------
  const bucketReportParams = convertToBucketReportFilterParams(recReportParams);
  // Create a report for each bucket
  const promisedBucketReports = dataBuckets.map(
    (bucket) => createReconciliationReportForBucket(bucket, bucketReportParams)
  );
  const bucketReports = await Promise.all(promisedBucketReports);

  bucketReports.forEach((bucketReport) => {
    report.filesInCumulus.okCount += bucketReport.okCount;
    report.filesInCumulus.onlyInS3 = report.filesInCumulus.onlyInS3.concat(bucketReport.onlyInS3);
    report.filesInCumulus.onlyInDynamoDb = report.filesInCumulus.onlyInDynamoDb.concat(
      bucketReport.onlyInDynamoDb
    );
  });

  // compare the CUMULUS holdings with the holdings in CMR
  // -----------------------------------------------------
  const cumulusCmrReport = await reconciliationReportForCumulusCMR({
    bucketsConfig, distributionBucketMap, recReportParams
  });
  report = Object.assign(report, cumulusCmrReport);

  // Create the full report
  report.createEndTime = moment.utc().toISOString();
  report.status = 'SUCCESS';

  // Write the full report to S3
  return s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report)
  }).promise();
}

/**
 * start the report generation process and save the record to database
 * @param {Object} params - params
 * @param {string} params.systemBucket - the name of the CUMULUS system bucket
 * @param {string} params.stackName - the name of the CUMULUS stack
 *   DynamoDB
 * @returns {Object} report record saved to the database
 */
async function processRequest(params) {
  const { systemBucket, stackName } = params;
  const createStartTime = moment.utc();
  const reportRecordName = `inventoryReport-${createStartTime.format('YYYYMMDDTHHmmssSSS')}`;
  const reportKey = `${stackName}/reconciliation-reports/${reportRecordName}.json`;

  // add request to database
  const reconciliationReportModel = new ReconciliationReport();
  const reportRecord = {
    name: reportRecordName,
    type: 'Inventory',
    status: 'Pending',
    location: buildS3Uri(systemBucket, reportKey)
  };
  await reconciliationReportModel.create(reportRecord);

  try {
    await createReconciliationReport({ ...params, createStartTime, reportKey });
    await reconciliationReportModel.updateStatus({ name: reportRecord.name }, 'Generated');
  } catch (error) {
    log.error(`${JSON.stringify(error)}`);
    log.error(`Error creating reconciliation report ${reportRecordName}`, error);
    const updates = {
      status: 'Failed',
      error: {
        Error: error.message,
        Cause: errorify(error)
      }
    };
    await reconciliationReportModel.update({ name: reportRecord.name }, updates);
  }

  return reconciliationReportModel.get({ name: reportRecord.name });
}

/**
 * Convert input to an ISO timestamp.
 * @param {any} dateable - any type convertable to JS Date
 * @returns {string} - date formated as ISO timestamp;
 */
function isoTimestamp(dateable) {
  if (dateable) {
    const aDate = new Date(dateable);
    if (Number.isNaN(aDate.valueOf())) {
      throw new TypeError(`${dateable} is not a valid input for new Date().`);
    }
    return aDate.toISOString();
  }
  return undefined;
}

/**
 * Converts input parameters to normalized versions to pass on to the report
 * functions.  Ensures any input dates are formatted as ISO strings.
 *
 * @param {Object} event - input payload
 * @returns {Object} - Object with normalized parameters
 */
function normalizeEvent(event) {
  const systemBucket = event.systemBucket || process.env.system_bucket;
  const stackName = event.stackName || process.env.stackName;
  const startTimestamp = isoTimestamp(event.startTimestamp);
  const endTimestamp = isoTimestamp(event.endTimestamp);
  return { systemBucket, stackName, startTimestamp, endTimestamp };
}

async function handler(event) {
  // increase the limit of search result from CMR.searchCollections/searchGranules
  process.env.CMR_LIMIT = process.env.CMR_LIMIT || 5000;
  process.env.CMR_PAGE_SIZE = process.env.CMR_PAGE_SIZE || 200;

  const reportParams = normalizeEvent(event);
  return processRequest(reportParams);
}
exports.handler = handler;
