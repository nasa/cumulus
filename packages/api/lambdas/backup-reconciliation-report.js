'use strict';

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');
const omit = require('lodash/omit');
const pick = require('lodash/pick');
const set = require('lodash/set');
const moment = require('moment');
const path = require('path');

const { s3 } = require('@cumulus/aws-client/services');
const { ESSearchQueue } = require('@cumulus/es-client/esSearchQueue');
const Logger = require('@cumulus/logger');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { errorify } = require('../lib/utils');
const {
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParams,
  initialReportHeader,
} = require('../lib/reconciliationReport');
const ORCASearchCatalogQueue = require('../lib/ORCASearchCatalogQueue');

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

  // get allFileNames(all file names) from cumulus and orca granules
  // for each file in allFileNames:
  //   file in both cumulus and orca,
  //     file type is excludedFromOrca -> add file to mismatchedFiles with conflict reason
  //     file type is not excludedFromOrca -> increase okFilesCount
  //   file only in cumulus,
  //     file type is excludedFromOrca -> increase okFilesCount
  //     file type is not excludedFromOrca -> add file to mismatchedFiles with conflict reason
  //   file only in orca, add file to conflict file with conflict reason

  // reducer, key: fileName, value: file object with selected fields
  const fileFields = ['bucket', 'key', 'cumulusArchiveLocation', 'orcaArchiveLocation', 'keyPath'];
  const fileReducer = (accumulator, currentValue) => {
    const fileName = currentValue.fileName
      || path.basename(currentValue.key || currentValue.keyPath);
    return ({
      ...accumulator,
      [fileName]: pick(currentValue, fileFields),
    });
  };

  const cumulusFiles = get(cumulusGranule, 'files', []).reduce(fileReducer, {});
  const orcaFiles = get(orcaGranule, 'files', []).reduce(fileReducer, {});
  const allFileNames = Object.keys({ ...cumulusFiles, ...orcaFiles });
  allFileNames.forEach((fileName) => {
    console.log(cumulusFiles[fileName], orcaFiles[fileName]);
    if (cumulusFiles[fileName] && orcaFiles[fileName]) {
      if (!isFileExcludedFromOrca(collectionsConfig, cumulusGranule.collectionId, fileName)) {
        oneGranuleReport.okFilesCount += 1;
      } else {
        const conflictFile = {
          ...cumulusFiles[fileName],
          orcaBucket: orcaFiles[fileName].orcaArchiveLocation,
          orcaKey: orcaFiles[fileName].keyPath,
          reason: 'shouldExcludedFromOrca',
        };
        oneGranuleReport.mismatchedFiles.push(conflictFile);
      }
    } else if (cumulusFiles[fileName] && orcaFiles[fileName] === undefined) {
      if (isFileExcludedFromOrca(collectionsConfig, cumulusGranule.collectionId, fileName)) {
        oneGranuleReport.okFilesCount += 1;
      } else {
        const conflictFile = {
          ...cumulusFiles[fileName],
          reason: 'onlyInCumulus',
        };
        oneGranuleReport.mismatchedFiles.push(conflictFile);
      }
    } else if (cumulusFiles[fileName] === undefined && orcaFiles[fileName]) {
      const conflictFile = {
        orcaBucket: orcaFiles[fileName].bucket,
        orcaKey: orcaFiles[fileName].key,
        reason: 'onlyInOrca',
      };
      oneGranuleReport.mismatchedFiles.push(conflictFile);
    }
  });

  if (oneGranuleReport.okFilesCount === allFileNames.length) oneGranuleReport.ok = true;

  return oneGranuleReport;
}

function constructOrcaOnlyGranuleForReport(orcaGranule) {
  const mismatchedFiles = orcaGranule.files.map((file) =>
    ({ ...pick(file, ['bucket', 'key']), reason: 'onlyInOrca' }));
  const mismatchedGranule = {
    ...pick(orcaGranule, ['granuleId', 'collectionId', 'providerId']),
    mismatchedFiles,
  };
  return mismatchedGranule;
}

function addGranuleToReport({ granulesReport, collectionsConfig, cumulusGranule, orcaGranule }) {
  /* eslint-disable no-param-reassign */
  if (cumulusGranule === undefined && orcaGranule) {
    granulesReport.mismatchedGranules.push(constructOrcaOnlyGranuleForReport(orcaGranule));
    granulesReport.mismatchedFilesCount += orcaGranule.files.length;
  }
  const granReport = getReportForOneGranule({
    collectionsConfig, cumulusGranule, orcaGranule,
  });

  if (granReport.ok) {
    granulesReport.okCount += 1;
  } else {
    granulesReport.mismatchedGranules.push(omit(granReport, ['ok']));
    granulesReport.mismatchedFilesCount += granReport.mismatchedFiles.length;
  }

  granulesReport.okFilesCount += granReport.okFilesCount;
  /* eslint-enable no-param-reassign */
  return granulesReport;
}

/**
 * Compare the granule holdings in ORCA with Cumulus
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
  //   Report okCount
  //   Report mismatchedGranules with mismatchedFiles
  log.info(`reconciliationReportForGranules ${params}`);
  const granulesReport = {
    okCount: 0,
    okFilesCount: 0,
    mismatchedFilesCount: 0,
    mismatchedGranules: [],
  };

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

  const orcaGranulesIterator = new ORCASearchCatalogQueue(esSearchParams);
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
        addGranuleToReport({
          granulesReport,
          collectionsConfig,
          cumulusGranule: nextCumulusItem,
        });
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
        addGranuleToReport({
          granulesReport,
          collectionsConfig,
          cumulusGranule: nextCumulusItem,
          orcaGranule: nextOrcaItem,
        });
        await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
        await orcaGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      }

      [nextCumulusItem, nextOrcaItem] = await Promise.all([esGranulesIterator.peek(), orcaGranulesIterator.peek()]); // eslint-disable-line max-len, no-await-in-loop
    }

    // Add any remaining cumulus items to the report
    while (await esGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
      const cumulusItem = await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      // Found an item that is only in Cumulus database and not in ORA.
      addGranuleToReport({
        granulesReport,
        collectionsConfig,
        cumulusGranule: cumulusItem,
      });
    }

    // Add any remaining ORCA items to the report
    while (await orcaGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
      const orcaItem = await orcaGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      // Found an item that is only in Cumulus database and not in ORA.
      addGranuleToReport({
        granulesReport,
        collectionsConfig,
        orcaGranule: orcaItem,
      });
    }
  } catch (error) {
    log.error('Error caught in reconciliationReportForGranules');
    log.error(errorify(error));
    throw error;
  }
  log.info('returning reconciliationReportForGranulesgranulesReport: '
           + `okCount: ${granulesReport.okCount}, `
           + `mismatchedGranules: ${granulesReport.mismatchedGranules.length}, `
           + `mismatchedFilesCount: ${granulesReport.mismatchedFilesCount}`);
  return {
    granulesReport,
  };
}
// export for testing
exports.reconciliationReportForGranules = reconciliationReportForGranules;

/**
 * Create a Backup Reconciliation report and save it to S3
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
async function createBackupReconciliationReport(recReportParams) {
  log.info(`createInternalReconciliationReport parameters ${JSON.stringify(recReportParams)}`);
  const {
    reportKey,
    systemBucket,
  } = recReportParams;

  // Write an initial report to S3
  const initialReportFormat = {
    okCount: 0,
    okFilesCount: 0,
    mismatchedFilesCount: 0,
    mismatchedGranules: [],
  };

  const report = {
    ...initialReportHeader(recReportParams),
    collections: cloneDeep(initialReportFormat),
    granules: cloneDeep(initialReportFormat),
  };

  await s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report, undefined, 2),
  }).promise();

  const granulesReport = await reconciliationReportForGranules(recReportParams);

  // Create the full report
  report.granules = granulesReport;
  report.createEndTime = moment.utc().toISOString();
  report.status = 'SUCCESS';

  // Write the full report to S3
  return s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report, undefined, 2),
  }).promise();
}

module.exports = {
  createBackupReconciliationReport,
};
