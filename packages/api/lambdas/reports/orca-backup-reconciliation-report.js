////@ts-check

'use strict';

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');
const omit = require('lodash/omit');
const pick = require('lodash/pick');
const set = require('lodash/set');
const moment = require('moment');
const path = require('path');

const {
  getGranulesByApiPropertiesQuery,
  QuerySearchClient,
  getKnexClient,
  FilePgModel,
} = require('@cumulus/db');
const { s3 } = require('@cumulus/aws-client/services');
const Logger = require('@cumulus/logger');
const { deconstructCollectionId, constructCollectionId } = require('@cumulus/message/Collections');
const filePgModel = new FilePgModel();

const {
  convertToDBGranuleSearchParams,
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
 * @param {[String]} recReportParams.collectionIds - array of collectionIds
 * @returns {Promise<Array>} - list of { collectionId, orca configuration }
 */
async function fetchCollectionsConfig(recReportParams) {
  const knex = await getKnexClient();
  const collectionsConfig = {};
  // TODO - DB Lib this?
  const query = knex('collections')
    .select('name', 'version', 'meta');
  if (recReportParams.collectionIds) { //TODO typing
    const collectionObjects = recReportParams.collectionIds.map((collectionId) =>
      deconstructCollectionId(collectionId));
    query.where((builder) => {
      collectionObjects.forEach(({ name, version }) => {
        builder.orWhere((qb) => {
          qb.where('name', name).andWhere('version', version);
        });
      });
    });
  }

  const pgCollectionSearchClient = new QuerySearchClient(query, 100);
  let nextPgItem = await pgCollectionSearchClient.shift();
  while (nextPgItem) {
    const collectionId = constructCollectionId(nextPgItem.name, nextPgItem.version);
    const excludedFileExtensions = get(nextPgItem, 'meta.orca.excludedFileExtensions');
    if (excludedFileExtensions) set(collectionsConfig, `${collectionId}.orca.excludedFileExtensions`, excludedFileExtensions);
    nextPgItem = await pgCollectionSearchClient.shift(); // eslint-disable-line no-await-in-loop
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

      if (
        !shouldFileBeExcludedFromOrca(
          collectionsConfig,
          constructCollectionId(
            cumulusGranule.collectionName,
            cumulusGranule.collectionVersion
          ),
          fileName
        )
      ) {
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

      if (
        shouldFileBeExcludedFromOrca(
          collectionsConfig,
          constructCollectionId(
            cumulusGranule.collectionName,
            cumulusGranule.collectionVersion
          ),
          fileName
        )
      ) {
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

// TODO - Docstring
// TODO - This method can *never* be called with cumulusGranule == undefined
// based on the parent logic. This should be enforced in the type system and throw
// an error if it is not the case.
// TODO - assumes that if orcaGranule isn't present that all files are conflicts
async function addGranuleToReport({
  granulesReport,
  collectionsConfig,
  cumulusGranule,
  orcaGranule,
  knex,
}) {
  if (!cumulusGranule) {
    throw new Error('cumulusGranule must be defined to add to the orca report');
  }

  const modifiedCumuluGranule = { ...cumulusGranule };

  modifiedCumuluGranule.files = await filePgModel.search(knex, {
    granule_cumulus_id: cumulusGranule.cumulus_id,
  });

  /* eslint-disable no-param-reassign */
  const granReport = getReportForOneGranule({
    knex,
    collectionsConfig,
    cumulusGranule: modifiedCumuluGranule,
    orcaGranule,
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

  // TODO - Generate this config from Postgres -- DONE
  const collectionsConfig = await fetchCollectionsConfig(recReportParams);
  log.debug(`fetchCollections returned ${JSON.stringify(collectionsConfig)}`);

  // TODO remove method and update to query for same response from postgres
  const knex = await getKnexClient();
  const searchParams = convertToDBGranuleSearchParams(recReportParams);

  const granulesSearchQuery = getGranulesByApiPropertiesQuery({
    knex,
    searchParams,
    sortByFields: ['granule_id', 'collectionName', 'collectionVersion'],
    temporalBoundByCreatedAt: true,
  });

  log.debug(`Create PG granule iterator with ${granulesSearchQuery}`);

  const pgGranulesIterator = new QuerySearchClient(
    granulesSearchQuery,
    100 // arbitrary limit on how items are fetched at once
    // TODO: Configure?x
  );

  const orcaSearchParams = convertToOrcaGranuleSearchParams(recReportParams);
  log.debug(`Create ORCA granule iterator with ${JSON.stringify(orcaSearchParams)}`);
  const orcaGranulesIterator = new ORCASearchCatalogQueue(orcaSearchParams);

  try {
    let [nextCumulusItem, nextOrcaItem] = await Promise.all(
      [pgGranulesIterator.peek(), orcaGranulesIterator.peek()]
    );

    while (nextCumulusItem && nextOrcaItem) {
      const nextCumulusId = `${nextCumulusItem.granule_id}:${constructCollectionId(nextCumulusItem.collectionName, nextCumulusItem.collectionVersion)}`;
      const nextOrcaId = `${nextOrcaItem.id}:${nextOrcaItem.collectionId}`;
      if (nextCumulusId < nextOrcaId) {
        // Found an item that is only in Cumulus and not in ORCA.
        // eslint-disable-next-line no-await-in-loop
        await addGranuleToReport({
          granulesReport,
          collectionsConfig,
          cumulusGranule: nextCumulusItem,
          knex,
        });
        granulesReport.cumulusCount += 1;
        await pgGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      } else if (nextCumulusId > nextOrcaId) {
        // Found an item that is only in ORCA and not in Cumulus
        granulesReport.onlyInOrca.push(constructOrcaOnlyGranuleForReport(nextOrcaItem));
        granulesReport.orcaCount += 1;
        await orcaGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      } else {
        // Found an item that is in both ORCA and Cumulus database
        // Check if the granule (files) should be in orca, and act accordingly
        // eslint-disable-next-line no-await-in-loop
        await addGranuleToReport({
          granulesReport,
          collectionsConfig,
          cumulusGranule: nextCumulusItem,
          orcaGranule: nextOrcaItem,
          knex,
        });
        granulesReport.cumulusCount += 1;
        granulesReport.orcaCount += 1;
        await pgGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
        await orcaGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      }

      [nextCumulusItem, nextOrcaItem] = await Promise.all([pgGranulesIterator.peek(), orcaGranulesIterator.peek()]); // eslint-disable-line max-len, no-await-in-loop
    }

    // Add any remaining cumulus items to the report
    while (await pgGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
      const cumulusItem = await pgGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
      // Found an item that is only in Cumulus database and not in ORCA.
      // eslint-disable-next-line no-await-in-loop
      await addGranuleToReport({
        granulesReport,
        collectionsConfig,
        cumulusGranule: cumulusItem,
        knex,
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
    log.error(`Error caught in orcaReconciliationReportForGranules: ${error}`);
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
    log.error(`Error caught in createOrcaBackupReconciliationReport: ${error}`);

    // Create the full report
    report.granules = granulesReport;
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
