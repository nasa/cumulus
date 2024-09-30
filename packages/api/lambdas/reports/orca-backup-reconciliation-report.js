//@ts-check

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

// Typedefs
/**
 * @typedef {Object} ConflictFile
 * @property {string} fileName
 * @property {string} bucket
 * @property {string} key
 * @property {string} [orcaBucket]
 * @property {string} reason
 */

/**
 * @typedef { import('@cumulus/db').PostgresGranuleRecord } PostgresGranuleRecord
 * @typedef {import('../../lib/types').RecReportParams } RecReportParams
 */

/**
 * @typedef {Object} GranuleReport
 * @property {boolean} ok
 * @property {number} okFilesCount
 * @property {number} cumulusFilesCount
 * @property {number} orcaFilesCount
 * @property {string} granuleId
 * @property {string} collectionId
 * @property {string} provider
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {ConflictFile[]} conflictFiles
 */
/**
 * @typedef {Object<string,
 * { orca: { excludedFileExtensions: string[] } } | undefined>} CollectionConfig
 */

/** @typedef {import('@cumulus/db').PostgresFileRecord} PostgresFileRecord */

/**
   * @typedef {Object} OrcaReportGranuleObject
   * @property {string} collectionId - The ID of the collection
   * @property {string} collectionName - The name of the collection associated with the granule
   * @property {string} collectionVersion - The version of
   * the collection associated with the granule
   * @property {string} providerName - The name of the provider associated with the granule
   * @property {PostgresFileRecord[]} files - The files associated with the granule
   */
/**
* @typedef {import('knex').Knex} Knex
*/
/**
 * @typedef {Object} GranulesReport
 * @property {number} okCount - The count of granules that are OK.
 * @property {number} cumulusCount - The count of granules in Cumulus.
 * @property {number} orcaCount - The count of granules in ORCA.
 * @property {number} okFilesCount - The count of files that are OK.
 * @property {number} cumulusFilesCount - The count of files in Cumulus.
 * @property {number} orcaFilesCount - The count of files in ORCA.
 * @property {number} conflictFilesCount - The count of files with conflicts.
 * @property {Array<Object>} withConflicts - The list of granules with conflicts.
 * @property {Array<Object>} onlyInCumulus - The list of granules only in Cumulus.
 * @property {Array<Object>} onlyInOrca - The list of granules only in ORCA.
 */

/** @typedef {OrcaReportGranuleObject & PostgresGranuleRecord } CumulusGranule */

const log = new Logger({ sender: '@api/lambdas/orca-backup-reconciliation-report' });

const fileConflictTypes = {
  shouldBeExcludedFromOrca: 'shouldBeExcludedFromOrca',
  onlyInCumulus: 'onlyInCumulus',
  onlyInOrca: 'onlyInOrca',
};

/**
 * Fetch orca configuration for all or specified collections
 *
 * @param {RecReportParams} recReportParams - input report params
 * @returns {Promise<CollectionConfig>} - list of { collectionId, orca configuration }
 */
async function fetchCollectionsConfig(recReportParams) {
  const knex = await getKnexClient();
  /** @type {CollectionConfig} */
  const collectionsConfig = {};
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

  /** @type {{ name: string, version: string, meta: Object }} */
  // @ts-ignore TODO: Ticket CUMULUS-3887 filed to resolve
  let nextPgItem = await pgCollectionSearchClient.shift();
  while (nextPgItem) {
    const collectionId = constructCollectionId(nextPgItem.name, nextPgItem.version);
    const excludedFileExtensions = get(nextPgItem, 'meta.orca.excludedFileExtensions');
    if (excludedFileExtensions) set(collectionsConfig, `${collectionId}.orca.excludedFileExtensions`, excludedFileExtensions);
    /** @type {{ name: string, version: string, meta: Object }} */
    // @ts-ignore TODO: Ticket CUMULUS-3887 filed to resolve
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
 * @param {CollectionConfig} params.collectionsConfig - collections configuration
 * @param {CumulusGranule} params.cumulusGranule - cumulus granule
 * @param {Object} params.orcaGranule - orca granule
 * @returns {GranuleReport} - discrepancy report of the granule
 */
function getReportForOneGranule({ collectionsConfig, cumulusGranule, orcaGranule }) {
  /** @type {GranuleReport} */
  const granuleReport = {
    ok: false,
    okFilesCount: 0,
    cumulusFilesCount: 0,
    orcaFilesCount: 0,
    ...{
      granuleId: cumulusGranule.granule_id,
      collectionId: constructCollectionId(
        cumulusGranule.collectionName,
        cumulusGranule.collectionVersion
      ),
      provider: cumulusGranule.providerName,
      createdAt: cumulusGranule.created_at.getTime(),
      updatedAt: cumulusGranule.updated_at.getTime(),
    },
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
  /**
   * @param {Object<string, {bucket: string, key: string} >} accumulator
   * @param {PostgresFileRecord} currentValue
   * @returns {Object<string, {bucket: string, key: string} >}
   */
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

  const cumulusFilesArray = /** @type {PostgresFileRecord[]} */ (get(cumulusGranule, 'files', []));
  const cumulusFiles = cumulusFilesArray.reduce(cumulusFileReducer, {});

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
        /** @type {ConflictFile} */
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

/**
 * Adds a granule to the reconciliation report object
 *
 * @param {Object} params - The parameters for the function.
 * @param {GranulesReport} params.granulesReport - The report object to update.
 * @param {CollectionConfig} params.collectionsConfig - The collections configuration.
 * @param {CumulusGranule} params.cumulusGranule - The Cumulus granule to add to the report.
 * @param {Object} [params.orcaGranule] - The ORCA granule to compare against (optional).
 * @param {Knex} params.knex - The Knex database connection.
 * @returns {Promise<Object>} The updated granules report.
 * @throws {Error} If cumulusGranule is not defined.
 */
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
  const modifiedCumulusGranule = { ...cumulusGranule };

  modifiedCumulusGranule.files = await filePgModel.search(knex, {
    granule_cumulus_id: cumulusGranule.cumulus_id,
  });

  /* eslint-disable no-param-reassign */
  const granReport = getReportForOneGranule({
    collectionsConfig,
    cumulusGranule: modifiedCumulusGranule,
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
 * @param {RecReportParams} recReportParams - input report params
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
  /** @type {GranulesReport} */
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
  log.debug(`fetchCollections returned ${JSON.stringify(collectionsConfig)}`);

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
  );

  const orcaSearchParams = convertToOrcaGranuleSearchParams(recReportParams);
  log.debug(`Create ORCA granule iterator with ${JSON.stringify(orcaSearchParams)}`);
  const orcaGranulesIterator = new ORCASearchCatalogQueue(orcaSearchParams);

  try {
    /** @type {[CumulusGranule, any]} */
    // @ts-ignore TODO: Ticket CUMULUS-3887 filed to resolve
    let [nextCumulusItem, nextOrcaItem] = await Promise.all(
      [
        /** @type CumulusGranule */
        pgGranulesIterator.peek(),
        orcaGranulesIterator.peek(),
      ]
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
      /** @type {[CumulusGranule, any]} */
      // @ts-ignore TODO: Ticket CUMULUS-3887 filed to resolve
      [nextCumulusItem, nextOrcaItem] = await Promise.all([pgGranulesIterator.peek(), orcaGranulesIterator.peek()]); // eslint-disable-line max-len, no-await-in-loop
    }

    // Add any remaining cumulus items to the report
    while (await pgGranulesIterator.peek()) { // eslint-disable-line no-await-in-loop
      /** @type {CumulusGranule} */
      // @ts-ignore TODO: Ticket CUMULUS-3887 filed to resolve
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
 * @param {RecReportParams} recReportParams - params
 * @returns {Promise<void>} a Promise that resolves when the report has been
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
  await s3().putObject({
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
