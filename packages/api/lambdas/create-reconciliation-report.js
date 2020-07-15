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
const { ESSearchQueue } = require('../es/esSearchQueue');
const { ESCollectionGranuleQueue } = require('../es/esCollectionGranuleQueue');
const { ReconciliationReport } = require('../models');
const { deconstructCollectionId, errorify } = require('../lib/utils');

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
 * Verify that all objects in an S3 bucket contain corresponding entries in
 * DynamoDB, and that there are no extras in either S3 or DynamoDB
 *
 * @param {string} Bucket - the bucket containing files to be reconciled
 * @returns {Promise<Object>} a report
 */
async function createReconciliationReportForBucket(Bucket) {
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
 * @returns {Promise<Object>} an object with the okCollections, onlyInCumulus and
 * onlyInCmr
 */
async function reconciliationReportForCollections() {
  // compare collection holdings:
  //   Get list of collections from CMR
  //   Get list of collections from CUMULUS
  //   Report collections only in CMR
  //   Report collections only in CUMULUS

  // get all collections from CMR and sort them, since CMR query doesn't support
  // 'Version' as sort_key
  const cmrSettings = await getCmrSettings();
  const cmr = new CMR(cmrSettings);
  const cmrCollectionItems = await cmr.searchCollections({}, 'umm_json');
  const cmrCollectionIds = cmrCollectionItems.map((item) =>
    constructCollectionId(item.umm.ShortName, item.umm.Version)).sort();

  // get all collections from Elasticsearch database and sort them.
  const esCollection = new ESSearchQueue({}, 'collection', process.env.ES_INDEX);
  const esCollectionItems = await esCollection.empty();
  const esCollectionIds = esCollectionItems.map(
    (item) => constructCollectionId(item.name, item.version)
  ).sort();

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
      collectionsOnlyInCmr.push(nextCmrCollectionId);
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
  collectionsOnlyInCmr = collectionsOnlyInCmr.concat(cmrCollectionIds);

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
 * @returns {Promise<Object>}                    - an object with the granulesReport and filesReport
 */
async function reconciliationReportForGranules(params) {
  // compare granule holdings:
  //   Get CMR granules list (by PROVIDER, short_name, version, sort_key: ['granule_ur'])
  //   Get CUMULUS granules list (by collectionId order by granuleId)
  //   Report granules only in CMR
  //   Report granules only in CUMULUS
  const { collectionId, bucketsConfig, distributionBucketMap } = params;
  const { name, version } = deconstructCollectionId(collectionId);
  const cmrSettings = await getCmrSettings();
  const cmrGranulesIterator = new CMRSearchConceptQueue({
    cmrSettings,
    type: 'granules',
    searchParams: { short_name: name, version: version, sort_key: ['granule_ur'] },
    format: 'umm_json'
  });

  const esGranulesIterator = new ESCollectionGranuleQueue({ collectionId }, process.env.ES_INDEX);

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
      granulesReport.onlyInCmr.push({
        GranuleUR: nextCmrGranuleId,
        ShortName: nextCmrItem.umm.CollectionReference.ShortName,
        Version: nextCmrItem.umm.CollectionReference.Version
      });
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
  while (await cmrGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
    const cmrItem = await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
    granulesReport.onlyInCmr.push({
      GranuleUR: cmrItem.umm.GranuleUR,
      ShortName: nextCmrItem.umm.CollectionReference.ShortName,
      Version: nextCmrItem.umm.CollectionReference.Version
    });
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
 * @returns {Promise<Object>}                    - a reconciliation report
 */
async function reconciliationReportForCumulusCMR(params) {
  const { bucketsConfig, distributionBucketMap } = params;
  const collectionReport = await reconciliationReportForCollections();
  const collectionsInCumulusCmr = {
    okCount: collectionReport.okCollections.length,
    onlyInCumulus: collectionReport.onlyInCumulus,
    onlyInCmr: collectionReport.onlyInCmr
  };

  // create granule and granule file report for collections in both Cumulus and CMR
  const promisedGranuleReports = collectionReport.okCollections.map((collectionId) =>
    reconciliationReportForGranules({ collectionId, bucketsConfig, distributionBucketMap }));
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
 * @param {Object} params - params
 * @param {moment} params.createStartTime - when the report creation was begun
 * @param {moment} params.endTimestamp - end of date range for report
 * @param {string} params.reportKey - the s3 report key
 * @param {string} params.stackName - the name of the CUMULUS stack
 * @param {moment} params.startTimestamp - begginning of date range for report
 * @param {string} params.systemBucket - the name of the CUMULUS system bucket
 * @returns {Promise<null>} a Promise that resolves when the report has been
 *   uploaded to S3
 */
async function createReconciliationReport(params) {
  const {
    createStartTime,
    endTimestamp,
    reportKey,
    stackName,
    startTimestamp,
    systemBucket
  } = params;

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
    createEndTime: null,
    reportStartTime: startTimestamp,
    reportEndTime: endTimestamp,
    status: 'RUNNING',
    error: null,
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

  // Create a report for each bucket
  const promisedBucketReports = dataBuckets.map(
    (bucket) => createReconciliationReportForBucket(bucket)
  );
  const bucketReports = await Promise.all(promisedBucketReports);

  // compare CUMULUS internal holdings in s3 and database
  bucketReports.forEach((bucketReport) => {
    report.filesInCumulus.okCount += bucketReport.okCount;
    report.filesInCumulus.onlyInS3 = report.filesInCumulus.onlyInS3.concat(bucketReport.onlyInS3);
    report.filesInCumulus.onlyInDynamoDb = report.filesInCumulus.onlyInDynamoDb.concat(
      bucketReport.onlyInDynamoDb
    );
  });

  // compare the CUMULUS holdings with the holdings in CMR
  const cumulusCmrReport = await reconciliationReportForCumulusCMR({
    bucketsConfig, distributionBucketMap
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

async function handler(event) {
  // increase the limit of search result from CMR.searchCollections/searchGranules
  process.env.CMR_LIMIT = process.env.CMR_LIMIT || 5000;
  process.env.CMR_PAGE_SIZE = process.env.CMR_PAGE_SIZE || 200;

  return processRequest({
    systemBucket: event.systemBucket || process.env.system_bucket,
    stackName: event.stackName || process.env.stackName,
    startTimestamp: event.startTimestamp || null,
    endTimestamp: event.endTimestamp || null
  });
}
exports.handler = handler;
