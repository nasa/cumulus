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

const { errorify } = require('../../lib/utils');
const {
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParamsWithCreatedAtRange,
  convertToOrcaGranuleSearchParams,
  initialReportHeader,
} = require('../../lib/reconciliationReport');
const ORCASearchCatalogQueue = require('../../lib/ORCASearchCatalogQueue');

const log = new Logger({ sender: '@api/lambdas/orca-backup-reconciliation-report' });

const fileConflictTypes = {
  shouldBeExcludedFromOrca: 'shouldBeExcludedFromOrca',
  onlyInCumulus: 'onlyInCumulus',
  onlyInOrca: 'onlyInOrca',
};

const granuleFields = ['granuleId', 'collectionId', 'provider', 'createdAt', 'updatedAt'];

/**
 * Fetch orca configuration for all or specified collections
 *
 * @param {Object} recReportParams - input report params
 * @param {Object} recReportParams.collectionIds - array of collectionIds
 * @returns {Promise<Array>} - list of { collectionId, orca configuration }
 */
async function fetchCollectionsConfig(recReportParams) {
  const collectionsConfig = {};
  const searchParams = convertToESCollectionSearchParams(pick(recReportParams, ['collectionIds']));
  const esCollectionsIterator = new ESSearchQueue(
    { ...searchParams, sort_key: ['name', 'version'] }, 'collection', process.env.ES_INDEX
  );
  let nextEsItem = await esCollectionsIterator.shift();
  while (nextEsItem) {
    const collectionId = constructCollectionId(nextEsItem.name, nextEsItem.version);
    const excludedFileExtensions = get(nextEsItem, 'meta.orca.excludedFileExtensions');
    if (excludedFileExtensions) set(collectionsConfig, `${collectionId}.orca.excludedFileExtensions`, excludedFileExtensions);
    nextEsItem = await esCollectionsIterator.shift(); // eslint-disable-line no-await-in-loop
  }

  return collectionsConfig;
}

/**
 * check if a file should be excluded from orca backup
 *
 * @param {Object} collectionsConfig - collections configuration
 * @param {Object} collectionId - collection id for the file
 * @param {string} fileName - file name
 * @returns {boolean} - whether the file should be excluded
 */
function shouldFileBeExcludedFromOrca(collectionsConfig, collectionId, fileName) {
  const excludedFileExtensions = get(collectionsConfig, `${collectionId}.orca.excludedFileExtensions`, []);
  return !!excludedFileExtensions.find((type) => fileName.endsWith(type));
}

/**
 * compare cumulus granule with its orcaGranule if any, and generate report
 *
 * @param {Object} params
 * @param {Object} params.collectionsConfig - collections configuration
 * @param {Object} params.cumulusGranule - cumulus granule
 * @param {Object} params.orcaGranule - orca granule
 * @returns {Object} - discrepency report of the granule
 */
function getReportForOneGranule({ collectionsConfig, cumulusGranule, orcaGranule }) {
  const granuleReport = {
    ok: false,
    okFilesCount: 0,
    cumulusFilesCount: 0,
    orcaFilesCount: 0,
    ...pick(cumulusGranule, granuleFields),
    conflictFiles: [],
  };

  // get allFileNames(all file names) from cumulus and orca granules
  // for each file in allFileNames:
  //   file is in both cumulus and orca,
  //     file should be excludedFromOrca -> add to conflictFiles with reason
  //                                        shouldBeExcludedFromOrca
  //     file should not be excludedFromOrca -> increase okFilesCount
  //   file is only in cumulus,
  //     file should be excludedFromOrca -> increase okFilesCount
  //     file type is not excludedFromOrca -> add to conflictFiles with reason 'onlyInCumulus'
  //   file is only in orca, add file to conflictFiles with reason 'onlyInOrca'
  // if no granule file conflicts, set granuleReport.ok to true

  // reducer, key: fileName, value: file object with selected fields
  const cumulusFileReducer = (accumulator, currentValue) => {
    const fileName = path.basename(currentValue.key);
    return ({
      ...accumulator,
      [fileName]: pick(currentValue, ['bucket', 'key']),
    });
  };
  const orcaFileReducer = (accumulator, currentValue) => {
    const fileName = path.basename(currentValue.keyPath);
    return ({
      ...accumulator,
      [fileName]: pick(currentValue, ['cumulusArchiveLocation', 'orcaArchiveLocation', 'keyPath']),
    });
  };

  const cumulusFiles = get(cumulusGranule, 'files', []).reduce(cumulusFileReducer, {});
  const orcaFiles = get(orcaGranule, 'files', []).reduce(orcaFileReducer, {});
  const allFileNames = Object.keys({ ...cumulusFiles, ...orcaFiles });
  allFileNames.forEach((fileName) => {
    if (cumulusFiles[fileName] && orcaFiles[fileName]) {
      granuleReport.cumulusFilesCount += 1;
      granuleReport.orcaFilesCount += 1;

      if (!shouldFileBeExcludedFromOrca(collectionsConfig, cumulusGranule.collectionId, fileName)) {
        granuleReport.okFilesCount += 1;
      } else {
        const conflictFile = {
          fileName,
          ...cumulusFiles[fileName],
          orcaBucket: orcaFiles[fileName].orcaArchiveLocation,
          reason: fileConflictTypes.shouldBeExcludedFromOrca,
        };
        granuleReport.conflictFiles.push(conflictFile);
      }
    } else if (cumulusFiles[fileName] && orcaFiles[fileName] === undefined) {
      granuleReport.cumulusFilesCount += 1;

      if (shouldFileBeExcludedFromOrca(collectionsConfig, cumulusGranule.collectionId, fileName)) {
        granuleReport.okFilesCount += 1;
      } else {
        const conflictFile = {
          fileName,
          ...cumulusFiles[fileName],
          reason: fileConflictTypes.onlyInCumulus,
        };
        granuleReport.conflictFiles.push(conflictFile);
      }
    } else if (cumulusFiles[fileName] === undefined && orcaFiles[fileName]) {
      granuleReport.orcaFilesCount += 1;
      const conflictFile = {
        fileName,
        bucket: orcaFiles[fileName].cumulusArchiveLocation,
        key: orcaFiles[fileName].keyPath,
        orcaBucket: orcaFiles[fileName].orcaArchiveLocation,
        reason: fileConflictTypes.onlyInOrca,
      };
      granuleReport.conflictFiles.push(conflictFile);
    }
  });

  granuleReport.ok = granuleReport.okFilesCount === allFileNames.length;
  return granuleReport;
}

function constructOrcaOnlyGranuleForReport(orcaGranule) {
  const conflictFiles = orcaGranule.files.map((file) => ({
    bucket: file.cumulusArchiveLocation,
    key: file.keyPath,
    fileName: path.basename(file.keyPath),
    orcaBucket: file.orcaArchiveLocation,
    reason: 'onlyInOrca',
  }));
  const granule = {
    okFilesCount: 0,
    cumulusFilesCount: 0,
    orcaFilesCount: orcaGranule.files.length,
    granuleId: orcaGranule.id,
    provider: orcaGranule.providerId,
    ...pick(orcaGranule, ['collectionId', 'createdAt', 'updatedAt']),
    conflictFiles,
  };
  return granule;
}

function addGranuleToReport({ granulesReport, collectionsConfig, cumulusGranule, orcaGranule }) {
  /* eslint-disable no-param-reassign */
  const granReport = getReportForOneGranule({
    collectionsConfig, cumulusGranule, orcaGranule,
  });

  if (granReport.ok) {
    granulesReport.okCount += 1;
  } else if (orcaGranule === undefined) {
    granulesReport.onlyInCumulus.push(omit(granReport, ['ok']));
  } else {
    granulesReport.withConflicts.push(omit(granReport, ['ok']));
  }
  granulesReport.conflictFilesCount += granReport.conflictFiles.length;
  granulesReport.okFilesCount += granReport.okFilesCount;
  granulesReport.cumulusFilesCount += granReport.cumulusFilesCount;
  granulesReport.orcaFilesCount += granReport.orcaFilesCount;
  /* eslint-enable no-param-reassign */
  return granulesReport;
}

/**
 * Compare the granule holdings in Cumulus with ORCA
 *
 * @param {Object} recReportParams - lambda's input filtering parameters
 * @returns {Promise<Object>} an object with the okCount, onlyInCumulus, onlyInOrca
 * and withConfilcts
 */
async function orcaReconciliationReportForGranules(recReportParams) {
  // compare granule holdings:
  //   Get ORCA granules list sort by granuleId, collectionId
  //   Get CUMULUS granules list sort by granuleId, collectionId
  //   Report ok granule count
  //   Report granules with conflictFiles
  //   Report granules only in cumulus
  //   Report granules only in orca
  log.info(`orcaReconciliationReportForGranules ${JSON.stringify(recReportParams)}`);
  const granulesReport = {
    okCount: 0,
    cumulusCount: 0,
    orcaCount: 0,
    okFilesCount: 0,
    cumulusFilesCount: 0,
    orcaFilesCount: 0,
    conflictFilesCount: 0,
    withConflicts: [],
    onlyInCumulus: [],
    onlyInOrca: [],
  };

  const collectionsConfig = await fetchCollectionsConfig(recReportParams);
  log.debug(`fetchESCollections returned ${JSON.stringify(collectionsConfig)}`);

  const esSearchParams = convertToESGranuleSearchParamsWithCreatedAtRange(recReportParams);
  log.debug(`Create ES granule iterator with ${JSON.stringify(esSearchParams)}`);
  const esGranulesIterator = new ESSearchQueue(
    {
      ...esSearchParams,
      sort_key: ['granuleId', 'collectionId'],
    },
    'granule',
    process.env.ES_INDEX
  );

  const orcaSearchParams = convertToOrcaGranuleSearchParams(recReportParams);
  log.debug(`Create ORCA granule iterator with ${JSON.stringify(orcaSearchParams)}`);
  const orcaGranulesIterator = new ORCASearchCatalogQueue(orcaSearchParams);

  try {
    let [nextCumulusItem, nextOrcaItem] = await Promise.all(
      [esGranulesIterator.peek(), orcaGranulesIterator.peek()]
    );

    while (nextCumulusItem && nextOrcaItem) {
      const nextCumulusId = `${nextCumulusItem.granuleId}:${nextCumulusItem.collectionId}`;
      const nextOrcaId = `${nextOrcaItem.id}:${nextOrcaItem.collectionId}`;
      if (nextCumulusId < nextOrcaId) {
        // Found an item that is only in Cumulus and not in ORCA.
        addGranuleToReport({
          granulesReport,
          collectionsConfig,
          cumulusGranule: nextCumulusItem,
        });
        granulesReport.cumulusCount += 1;
        await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      } else if (nextCumulusId > nextOrcaId) {
        // Found an item that is only in ORCA and not in Cumulus
        granulesReport.onlyInOrca.push(constructOrcaOnlyGranuleForReport(nextOrcaItem));
        granulesReport.orcaCount += 1;
        await orcaGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      } else {
        // Found an item that is in both ORCA and Cumulus database
        // Check if the granule (files) should be in orca, and act accordingly
        addGranuleToReport({
          granulesReport,
          collectionsConfig,
          cumulusGranule: nextCumulusItem,
          orcaGranule: nextOrcaItem,
        });
        granulesReport.cumulusCount += 1;
        granulesReport.orcaCount += 1;
        await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
        await orcaGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      }

      [nextCumulusItem, nextOrcaItem] = await Promise.all([esGranulesIterator.peek(), orcaGranulesIterator.peek()]); // eslint-disable-line max-len, no-await-in-loop
    }

    // Add any remaining cumulus items to the report
    while (await esGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
      const cumulusItem = await esGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      // Found an item that is only in Cumulus database and not in ORCA.
      addGranuleToReport({
        granulesReport,
        collectionsConfig,
        cumulusGranule: cumulusItem,
      });
      granulesReport.cumulusCount += 1;
    }

    // Add any remaining ORCA items to the report
    while (await orcaGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
      const orcaItem = await orcaGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      granulesReport.onlyInOrca.push(constructOrcaOnlyGranuleForReport(orcaItem));
      granulesReport.conflictFilesCount += get(orcaItem, 'files', []).length;
      granulesReport.orcaFilesCount += get(orcaItem, 'files', []).length;
      granulesReport.orcaCount += 1;
    }
  } catch (error) {
    log.error('Error caught in orcaReconciliationReportForGranules');
    log.error(errorify(error));
    throw error;
  }

  const reportSummary = Object.entries(granulesReport)
    .map(([key, value]) => `${key} ${Array.isArray(value) ? value.length : value}`);

  log.info(`returning orcaReconciliationReportForGranules report: ${reportSummary.join(', ')}`);
  return granulesReport;
}

/**
 * Create an ORCA Backup Reconciliation report and save it to S3
 *
 * @param {Object} recReportParams - params
 * @param {Object} recReportParams.collectionIds - array of collectionIds
 * @param {Object} recReportParams.providers - array of providers
 * @param {Object} recReportParams.granuleIds - array of granuleIds
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
async function createOrcaBackupReconciliationReport(recReportParams) {
  log.info(`createOrcaBackupReconciliationReport parameters ${JSON.stringify(recReportParams)}`);
  let granulesReport;
  const {
    reportKey,
    systemBucket,
  } = recReportParams;

  // Write an initial report to S3
  const initialReportFormat = {
    okCount: 0,
    cumulusCount: 0,
    orcaCount: 0,
    okFilesCount: 0,
    cumulusFilesCount: 0,
    orcaFilesCount: 0,
    conflictFilesCount: 0,
    withConflicts: [],
    onlyInCumulus: [],
    onlyInOrca: [],
  };

  const report = {
    ...initialReportHeader(recReportParams),
    granules: cloneDeep(initialReportFormat),
  };

  await s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report, undefined, 2),
  });

  try {
    granulesReport = await orcaReconciliationReportForGranules(recReportParams);
  } catch (error) {
    log.error('Error caught in createOrcaBackupReconciliationReport');
    log.error(errorify(error));
    throw error;
  }

  // Create the full report
  report.granules = granulesReport;
  report.createEndTime = moment.utc().toISOString();
  report.status = 'SUCCESS';

  // Write the full report to S3
  return s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report, undefined, 2),
  });
}

module.exports = {
  fileConflictTypes,
  orcaReconciliationReportForGranules,
  createOrcaBackupReconciliationReport,
};
