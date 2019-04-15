'use strict';

const clonedeep = require('lodash.clonedeep');
const keyBy = require('lodash.keyby');
const moment = require('moment');
const {
  aws: {
    buildS3Uri,
    S3ListObjectsV2Queue,
    s3
  },
  bucketsConfigJsonObject,
  BucketsConfig,
  constructCollectionId
} = require('@cumulus/common');

const { CMR, CMRSearchConceptQueue, constructOnlineAccessUrl } = require('@cumulus/cmrjs');
const { Collection, Granule, FileClass } = require('../models');
const { deconstructCollectionId } = require('../lib/utils');

/**
 * Verify that all objects in an S3 bucket contain corresponding entries in
 * DynamoDB, and that there are no extras in either S3 or DynamoDB
 *
 * @param {string} Bucket - the bucket containing files to be reconciled
 * @returns {Promise<Object>} a report
 */
async function createReconciliationReportForBucket(Bucket) {
  const s3ObjectsQueue = new S3ListObjectsV2Queue({ Bucket });
  const dynamoDbFilesLister = new FileClass().getFilesForBucket(Bucket);

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
  const cmr = new CMR(process.env.cmr_provider, process.env.cmr_client_id);
  const cmrCollectionItems = await cmr.searchCollections({}, 'umm_json');
  const cmrCollectionIds = cmrCollectionItems.map((item) =>
    constructCollectionId(item.umm.ShortName, item.umm.Version)).sort();

  // get all collections from database and sort them, since the scan result is not ordered
  const dbCollectionsItems = await new Collection().getAllCollections();
  const dbCollectionIds = dbCollectionsItems.map((item) =>
    constructCollectionId(item.name, item.version)).sort();

  const okCollections = [];
  let collectionsOnlyInCumulus = [];
  let collectionsOnlyInCmr = [];

  let nextDbCollectionId = (dbCollectionIds.length !== 0) ? dbCollectionIds[0] : null;
  let nextCmrCollectionId = (cmrCollectionIds.length !== 0) ? cmrCollectionIds[0] : null;

  while (nextDbCollectionId && nextCmrCollectionId) {
    if (nextDbCollectionId < nextCmrCollectionId) {
      // Found an item that is only in database and not in cmr
      await dbCollectionIds.shift(); // eslint-disable-line no-await-in-loop
      collectionsOnlyInCumulus.push(nextDbCollectionId);
    } else if (nextDbCollectionId > nextCmrCollectionId) {
      // Found an item that is only in cmr and not in database
      collectionsOnlyInCmr.push(nextCmrCollectionId);
      cmrCollectionIds.shift();
    } else {
      // Found an item that is in both cmr and database
      okCollections.push(nextDbCollectionId);
      dbCollectionIds.shift();
      cmrCollectionIds.shift();
    }

    nextDbCollectionId = (dbCollectionIds.length !== 0) ? dbCollectionIds[0] : null;
    nextCmrCollectionId = (cmrCollectionIds.length !== 0) ? cmrCollectionIds[0] : null;
  }

  // Add any remaining database items to the report
  collectionsOnlyInCumulus = collectionsOnlyInCumulus.concat(dbCollectionIds);

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
 *
 * @param {Object} granuleInDb - granule object in database
 * @param {Object} granuleInCmr - granule object in CMR
 * @param {Object} bucketsConfig - bucket configuration object
 * @returns {Promise<Object>} an object with the okCount, onlyInCumulus, onlyInCmr
 */
async function reconciliationReportForGranuleFiles(granuleInDb, granuleInCmr, bucketsConfig) {
  let okCount = 0;
  const onlyInCumulus = [];
  const onlyInCmr = [];

  const granuleFiles = keyBy(granuleInDb.files, 'fileName');

  // URL types for downloading granule files
  const cmrGetDataTypes = ['GET DATA', 'GET RELATED VISUALIZATION'];
  const cmrRelatedDataTypes = ['VIEW RELATED INFORMATION'];

  // check each URL entry against database records
  granuleInCmr.RelatedUrls.forEach((relatedUrl) => {
    // only check URL types for downloading granule files and related data (such as documents)
    if (cmrGetDataTypes.includes(relatedUrl.Type)
      || cmrRelatedDataTypes.includes(relatedUrl.Type)) {
      const urlFileName = relatedUrl.URL.split('/').pop();

      // filename in both cumulus and CMR
      if (granuleFiles[urlFileName] && bucketsConfig.key(granuleFiles[urlFileName].bucket)) {
        // not all files should be in CMR
        const accessUrl = constructOnlineAccessUrl({
          file: granuleFiles[urlFileName],
          distEndpoint: process.env.DISTRIBUTION_ENDPOINT,
          buckets: bucketsConfig
        });

        if (accessUrl && relatedUrl.URL === accessUrl.URL) {
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
 * @param {string} collectionId - the collection which has the granules to be reconciled
 * @param {Object} bucketsConfig - bucket configuration object
 * @returns {Promise<Object>} an object with the granulesReport and filesReport
 */
async function reconciliationReportForGranules(collectionId, bucketsConfig) {
  // compare granule holdings:
  //   Get CMR granules list (by PROVIDER, short_name, version, sort_key: ['granule_ur'])
  //   Get CUMULUS granules list (by collectionId order by granuleId)
  //   Report granules only in CMR
  //   Report granules only in CUMULUS
  const { name, version } = deconstructCollectionId(collectionId);
  const cmrGranulesIterator = new CMRSearchConceptQueue(
    process.env.cmr_provider, process.env.cmr_client_id, 'granules',
    { short_name: name, version: version, sort_key: ['granule_ur'] }, 'umm_json'
  );

  const dbGranulesIterator = new Granule().getGranulesForCollection(collectionId, 'completed');

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

  let [nextDbItem, nextCmrItem] = await Promise.all([dbGranulesIterator.peek(), cmrGranulesIterator.peek()]); // eslint-disable-line max-len

  while (nextDbItem && nextCmrItem) {
    const nextDbGranuleId = nextDbItem.granuleId;
    const nextCmrGranuleId = nextCmrItem.umm.GranuleUR;

    if (nextDbGranuleId < nextCmrGranuleId) {
      // Found an item that is only in database and not in cmr
      granulesReport.onlyInCumulus.push({
        granuleId: nextDbGranuleId,
        collectionId: collectionId
      });
      await dbGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
    } else if (nextDbGranuleId > nextCmrGranuleId) {
      // Found an item that is only in cmr and not in database
      granulesReport.onlyInCmr.push({
        GranuleUR: nextCmrGranuleId,
        ShortName: nextCmrItem.umm.CollectionReference.ShortName,
        Version: nextCmrItem.umm.CollectionReference.Version
      });
      await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
    } else {
      // Found an item that is in both cmr and database
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
      await dbGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      await cmrGranulesIterator.shift(); // eslint-disable-line no-await-in-loop

      // compare the files now to avoid keeping the granules' information in memory
      // eslint-disable-next-line no-await-in-loop
      const fileReport = await reconciliationReportForGranuleFiles(
        granuleInDb, granuleInCmr, bucketsConfig
      );
      filesReport.okCount += fileReport.okCount;
      filesReport.onlyInCumulus = filesReport.onlyInCumulus.concat(fileReport.onlyInCumulus);
      filesReport.onlyInCmr = filesReport.onlyInCmr.concat(fileReport.onlyInCmr);
    }

    [nextDbItem, nextCmrItem] = await Promise.all([dbGranulesIterator.peek(), cmrGranulesIterator.peek()]); // eslint-disable-line max-len, no-await-in-loop
  }

  // Add any remaining DynamoDB items to the report
  while (await dbGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
    const dbItem = await dbGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
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
 * @param {Object} bucketsConfig - bucket configuration object
 * @returns {Promise<Object>} a reconciliation report
 */
async function reconciliationReportForCumulusCMR(bucketsConfig) {
  const collectionReport = await reconciliationReportForCollections();
  const collectionsInCumulusCmr = {
    okCount: collectionReport.okCollections.length,
    onlyInCumulus: collectionReport.onlyInCumulus,
    onlyInCmr: collectionReport.onlyInCmr
  };

  // create granule and granule file report for collections in both Cumulus and CMR
  const promisedGranuleReports = collectionReport.okCollections.map((collectionId) =>
    reconciliationReportForGranules(collectionId, bucketsConfig));
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
 * @param {string} params.systemBucket - the name of the CUMULUS system bucket
 * @param {string} params.stackName - the name of the CUMULUS stack
 *   DynamoDB
 * @returns {Promise<null>} a Promise that resolves when the report has been
 *   uploaded to S3
 */
async function createReconciliationReport(params) {
  const {
    systemBucket,
    stackName
  } = params;

  // Fetch the bucket names to reconcile
  const bucketsConfigJson = await bucketsConfigJsonObject(systemBucket, stackName);
  const dataBuckets = Object.values(bucketsConfigJson)
    .filter((config) => config.name !== systemBucket).map((config) => config.name);

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
    reportStartTime: moment.utc().toISOString(),
    reportEndTime: null,
    status: 'RUNNING',
    error: null,
    filesInCumulus,
    collectionsInCumulusCmr: clonedeep(reportFormatCumulusCmr),
    granulesInCumulusCmr: clonedeep(reportFormatCumulusCmr),
    filesInCumulusCmr: clonedeep(reportFormatCumulusCmr)
  };

  const reportKey = `${stackName}/reconciliation-reports/report-${report.reportStartTime}.json`;

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
    report.filesInCumulus.onlyInDynamoDb = report.filesInCumulus
      .onlyInDynamoDb.concat(bucketReport.onlyInDynamoDb);
  });

  // compare the CUMULUS holdings with the holdings in CMR
  const cumulusCmrReport = await reconciliationReportForCumulusCMR(bucketsConfig);
  report = Object.assign(report, cumulusCmrReport);

  // Create the full report
  report.reportEndTime = moment.utc().toISOString();
  report.status = 'SUCCESS';

  // Write the full report to S3
  return s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report)
  }).promise()
    .then(() => null);
}

function handler(event, _context, cb) {
  // increase the limit of search result from CMR.searchCollections/searchGranules
  process.env.CMR_LIMIT = process.env.CMR_LIMIT || 5000;
  process.env.CMR_PAGE_SIZE = process.env.CMR_PAGE_SIZE || 200;

  return createReconciliationReport({
    systemBucket: event.systemBucket || process.env.system_bucket,
    stackName: event.stackName || process.env.stackName
  })
    .then(() => cb(null))
    .catch(cb);
}
exports.handler = handler;
