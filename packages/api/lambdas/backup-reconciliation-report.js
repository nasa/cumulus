'use strict';

const get = require('lodash/get');
const omit = require('lodash/omit');
const pick = require('lodash/pick');
const set = require('lodash/set');
const sortBy = require('lodash/sortBy');
const path = require('path');
const { buildS3Uri, getJsonS3Object } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { getBucketsConfigKey } = require('@cumulus/common/stack');
const {
  getFilesAndGranuleInfoQuery,
  getKnexClient,
  QuerySearchClient,
} = require('@cumulus/db');
const { fetchDistributionBucketMap } = require('@cumulus/distribution-utils');
const { ESCollectionGranuleQueue } = require('@cumulus/es-client/esCollectionGranuleQueue');
const { ESSearchQueue } = require('@cumulus/es-client/esSearchQueue');
const Logger = require('@cumulus/logger');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { createInternalReconciliationReport } = require('./internal-reconciliation-report');
const { createGranuleInventoryReport } = require('./reports/granule-inventory-report');
const { ReconciliationReport } = require('../models');
const { deconstructCollectionId, errorify } = require('../lib/utils');
const {
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParams,
  initialReportHeader,
} = require('../lib/reconciliationReport');

const log = new Logger({ sender: '@api/lambdas/create-reconciliation-report' });

/**
 * Fetch collections in Elasticsearch.
 * @param {Object} recReportParams - input report params.
 * @returns {Promise<Array>} - list of collectionIds that match input paramaters
 */
async function fetchESCollections(recReportParams) {
  const collectionsConfig = {};
  const searchParams = convertToESCollectionSearchParams(recReportParams);
  const esCollectionsIterator = new ESSearchQueue(
    { ...searchParams, sort_key: ['name', 'version'] }, 'collection', process.env.ES_INDEX
  );
  let nextEsItem = await esCollectionsIterator.shift();
  while (nextEsItem) {
    const collectionId = constructCollectionId(nextEsItem.name, nextEsItem.version);
    const excludeFileTypes = get(nextEsItem, 'meta.excludeFileTypes');
    if (excludeFileTypes) set(collectionsConfig, `${collectionId}.orca.excludeFileTypes`, excludeFileTypes);
    nextEsItem = await esCollectionsIterator.shift(); // eslint-disable-line no-await-in-loop
  }

  return collectionsConfig;
}

function isFileExcludedFromOrca(collectionsConfig, collectionId, fileName) {
  const excludeFileTypes = get(collectionsConfig, `${collectionId}.orca.excludeFileTypes`, []);
  if (excludeFileTypes.find((type) => fileName.endsWith(type))) return true;
  return false;
}

function getReportForOneGranule({ collectionsConfig, cumulusGranule, orcaGranule }) {
  const oneGranuleReport = {
    ok: false,
    okFilesCount: 0,
    ...pick(cumulusGranule, ['granuleId', 'collectionId', 'providerId']),
    mismatchedFiles: [],
  };
  //TODO cumulus/orca files keyed by fileName
  // allFileNames
  // for each file in allFileNames
  // file in both cumulus, excludedFromOrca -> add to conflict file and reason shoud not in orca
  //           not excludedFromOrca -> okFilesCount
  // file only in cumulus, excludedFromOrca ->okFilesCount
  //           not excludedFromOrca -> add to conflict file and reason
  // file only in orca, add to conflict file and reason, extra file only in orca

  // reducer, key fileName, value: file object
  const reducer = (accumulator, currentValue) => {
    const fileName = currentValue.fileName || path.basename(currentValue.key);
    return ({
      ...accumulator,
      [fileName]: pick(currentValue, ['bucket', 'key']),
    });
  };

  const cumulusFiles = get(cumulusGranule, 'files', []).reduce(reducer, {});
  const orcaFiles = get(orcaGranule, 'files', []).reduce(reducer, {});
  const allFileNames = Object.keys({ ...cumulusFiles, ...orcaFiles });
  allFileNames.forEach((fileName) => {
    if (cumulusFiles[fileName] && orcaFiles[fileName]) {
      if (!isFileExcludedFromOrca(collectionsConfig, cumulusGranule.collectionId, fileName)) {
        oneGranuleReport.okFilesCount += 1;
      } else {
        const conflictFile = {
          ...cumulusFiles[fileName],
          orcaBucket: orcaFiles[fileName].bucket,
          orcaKey: orcaFiles[fileName].key,
          reason: 'fileShouldExcludedFromOrca',
        };
        oneGranuleReport.mismatchedFiles.push(conflictFile);
      }
    } else if (cumulusFiles[fileName] && orcaFiles[fileName] === undefined) {
      if (isFileExcludedFromOrca(collectionsConfig, cumulusGranule.collectionId, fileName)) {
        oneGranuleReport.okFilesCount += 1;
      } else {
        const conflictFile = {
          ...cumulusFiles[fileName],
          reason: 'fileOnlyInCumulus',
        };
        oneGranuleReport.mismatchedFiles.push(conflictFile);
      }
    } else if (cumulusFiles[fileName] === undefined && orcaFiles[fileName]) {
      const conflictFile = {
        orcaBucket: orcaFiles[fileName].bucket,
        orcaKey: orcaFiles[fileName].key,
        reason: 'fileOnlyInOrca',
      };
      oneGranuleReport.mismatchedFiles.push(conflictFile);
    }
  });

  if (oneGranuleReport.okFilesCount === allFileNames.length) oneGranuleReport.ok = true;

  return oneGranuleReport;
}

function addGranuleToReport(report, granReport) {
  const granulesReport = report;
  if (granReport.ok) {
    granulesReport.okCount += 1;
  } else {
    granulesReport.mismatchedGranules.push(omit(granReport, ['ok']));
  }

  granulesReport.okFilesCount += granReport.okFilesCount;

  return granulesReport;
}

/**
 * Compare the granule holdings in ORA with Cumulus
 *
 * @param {Object} params                        - parameters
 * @param {string} params.collectionId           - the collection which has the granules to be
 *                                                 reconciled
 * @param {Object} params.recReportParams        - Lambda report paramaters for narrowing focus
 * @returns {Promise<Object>}                    - an object with the granulesReport and filesReport
 */
async function reconciliationReportForGranules(params) {
  // compare granule holdings:
  //   Get ORCA granules list sort by granuleId, collectionId
  //   Get CUMULUS granules list sort by granuleId, collectionId
  //   Report granules only in ORCA
  //   Report granules only in CUMULUS
  log.info(`reconciliationReportForGranules ${params}`);
  const granulesReport = { okCount: 0, onlyInCumulus: [], onlyInOrca: [] };

  const esSearchParams = convertToESGranuleSearchParams(params);
  log.debug(`Create ES granule iterator with ${JSON.stringify(esSearchParams)}`);
  const esGranulesIterator = new ESSearchQueue(
    {
      ...esSearchParams,
      sort_key: ['granuleId', 'collectionId'],
    },
    'granule',
    process.env.ES_INDEX
  );

  const orcaGranulesIterator = new ESSearchQueue(
    {
      ...esSearchParams,
      sort_key: ['granuleId', 'collectionId'],
    },
    'granule',
    process.env.ES_INDEX
  );

  // TODO granuleId + collectionId is unique
  const collectionsConfig = await fetchESCollections(params);

  try {
    let [nextCumulusItem, nextOrcaItem] = await Promise.all(
      [esGranulesIterator.peek(), orcaGranulesIterator.peek()]
    );

    while (nextCumulusItem && nextOrcaItem) {
      const nextCumulusId = `${nextCumulusItem.granuleId}:${nextCumulusItem.collectionId}`;
      const nextOrcaId = `${nextOrcaItem.granuleId}:${nextOrcaItem.collectionId}`;

      if (nextCumulusId < nextOrcaId) {
        // Found an item that is only in Cumulus database and not in ORA.
        // Check if the granule (files) should be in orca, and act accordingly.
        const granReport = getReportForOneGranule({
          collectionsConfig, cumulusGranule: nextCumulusItem,
        });
        if (granReport.ok) {
          granulesReport.okCount += 1;
          granulesReport.okFilesCount += granReport.okFilesCount;
        } else {
          // TODO report granule file discrepency, not use onlyInCumulus
          granulesReport.onlyInCumulus.push(
            pick(nextCumulusItem, ['granuleId', 'collectionId', 'providerId'])
          );
        }
        await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      } else if (nextCumulusId > nextOrcaId) {
        // Found an item that is only in ORA and not in Cumulus database
        granulesReport.onlyInOrca.push(
          pick(nextOrcaItem, ['granuleId', 'collectionId', 'providerId'])
        );
        await orcaGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      } else {
        // Found an item that is in both ORA and Cumulus database
        // Check if the granule (files) should be in orca, and act accordingly
        const granReport = getReportForOneGranule({
          collectionsConfig, cumulusGranule: nextCumulusItem,
        });
        if (granReport.ok) {
          granulesReport.okCount += 1;
          granulesReport.okFilesCount += granReport.okFilesCount;
        } else {
          granulesReport.mismatchedFilesCount += granReport.mismatchedFiles.length;
          granulesReport.onlyInCumulus.push({
            granuleId: nextCumulusId,
            collectionId: nextCumulusItem.collectionId,
          });
        }

        await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
        await orcaGranulesIterator.shift(); // eslint-disable-line no-await-in-loop

        // compare the files now to avoid keeping the granules' information in memory
        // eslint-disable-next-line no-await-in-loop
        // const fileReport = await reconciliationReportForGranuleFiles({
        //   granuleInDb, granuleInCmr, bucketsConfig, distributionBucketMap,
        // });
        // filesReport.okCount += fileReport.okCount;
        // filesReport.onlyInCumulus = filesReport.onlyInCumulus.concat(fileReport.onlyInCumulus);
        // filesReport.onlyInCmr = filesReport.onlyInCmr.concat(fileReport.onlyInCmr);
      }

      [nextCumulusItem, nextOrcaItem] = await Promise.all([esGranulesIterator.peek(), orcaGranulesIterator.peek()]); // eslint-disable-line max-len, no-await-in-loop
    }

    // Add any remaining DynamoDB items to the report
    while (await esGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
      const cumulusItem = await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      // Found an item that is only in Cumulus database and not in ORA.
      // Check if the granule (files) should be in orca, and act accordingly.
      const granReport = getReportForOneGranule({
        collectionsConfig, cumulusGranule: cumulusItem,
      });
      if (granReport.okCount === 1) {
        granulesReport.okCount += 1;
      } else {
        granulesReport.onlyInCumulus.push(
          pick(cumulusItem, ['granuleId', 'collectionId', 'providerId'])
        );
      }
    }

    // Add any remaining ORA items to the report
  } catch (error) {
    log.error('Error caught in reconciliationReportForGranules');
    log.error(errorify(error));
    throw error;
  }
  log.info('returning reconciliationReportForGranulesgranulesReport: '
           + `okCount: ${granulesReport.okCount} onlyInCumulus: ${granulesReport.onlyInCumulus.length}, `
           + `onlyInOrca: ${granulesReport.onlyInOrca.length}`);
  return {
    granulesReport,
  };
}
// export for testing
exports.reconciliationReportForGranules = reconciliationReportForGranules;

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

  await s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report),
  }).promise();

  // TODO use JSONStream

  log.info(`Writing report to S3: at ${systemBucket}/${reportKey}`);
  // Create the full report
  report.createEndTime = moment.utc().toISOString();
  report.status = 'SUCCESS';

  // Write the full report to S3
  return s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report),
  }).promise();
}
