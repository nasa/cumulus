'use strict';

const cloneDeep = require('lodash/cloneDeep');
const pick = require('lodash/pick');
const sortBy = require('lodash/sortBy');
const isEqual = require('lodash/isEqual');
const union = require('lodash/union');
const omit = require('lodash/omit');
const moment = require('moment');
const pLimit = require('p-limit');
const Logger = require('@cumulus/logger');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { s3 } = require('@cumulus/aws-client/services');
const { ESSearchQueue } = require('../es/esSearchQueue');
const { Collection, Granule } = require('../models');
const { convertToCollectionSearchParams, convertToGranuleSearchParams } = require('../lib/reconciliationReport');
const log = new Logger({ sender: '@api/lambdas/internal-reconciliation-report' });

/**
 * Compare the collection holdings in Elasticsearch with Database
 *
 * @param {Object} recReportParams - lambda's input filtering parameters to
 *                                   narrow limit of report.
 * @returns {Promise<Object>} an object with the okCount, onlyInEs, onlyInDb
 * and withConfilcts
 */
async function reconciliationReportForCollections(recReportParams) {
  log.debug('internal-reconciliation-report reconciliationReportForCollections');
  // compare collection holdings:
  //   Get collection list in ES ordered by granuleId
  //   Get collection list in DynamoDB ordered by granuleId
  //   Report collections only in ES
  //   Report collections only in DynamoDB
  //   Report collections with different contents

  const searchParams = convertToCollectionSearchParams(recReportParams);
  const esCollectionsIterator = new ESSearchQueue(
    { ...searchParams, sort_key: ['name', 'version'] }, 'collection', process.env.ES_INDEX
  );

  // get collections from database and sort them, since the scan result is not ordered
  const dbCollectionsQueue = await (new Collection()).search(searchParams);
  const dbCollectionItems = sortBy(await dbCollectionsQueue.empty(), ['name', 'version']);

  let okCount = 0;
  const withConflicts = [];
  let onlyInEs = [];
  let onlyInDb = [];

  const fieldsIgnored = ['timestamp', 'updatedAt'];
  let nextEsItem = await esCollectionsIterator.peek();
  let nextDbItem = (dbCollectionItems.length !== 0) ? dbCollectionItems[0] : null;

  while (nextEsItem && nextDbItem) {
    const esCollectionId = constructCollectionId(nextEsItem.name, nextEsItem.version);
    const dbCollectionId = constructCollectionId(nextDbItem.name, nextDbItem.version);

    if (esCollectionId < dbCollectionId) {
      // Found an item that is only in ES and not in DB
      onlyInEs.push(esCollectionId);
      await esCollectionsIterator.shift(); // eslint-disable-line no-await-in-loop
    } else if (esCollectionId > dbCollectionId) {
      // Found an item that is only in DB and not in ES
      onlyInDb.push(dbCollectionId);
      dbCollectionItems.shift();
    } else {
      // Found an item that is in both ES and DB
      if (isEqual(omit(nextEsItem, fieldsIgnored), omit(nextDbItem, fieldsIgnored))) {
        okCount += 1;
      } else {
        withConflicts.push({ es: nextEsItem, db: nextDbItem });
      }
      esCollectionsIterator.shift();
      dbCollectionItems.shift();
    }

    nextEsItem = await esCollectionsIterator.peek(); // eslint-disable-line no-await-in-loop
    nextDbItem = (dbCollectionItems.length !== 0) ? dbCollectionItems[0] : null;
  }

  // Add any remaining ES items to the report
  onlyInEs = onlyInEs.concat(
    (await esCollectionsIterator.empty())
      .map((item) => constructCollectionId(item.name, item.version))
  );

  // Add any remaining DB items to the report
  onlyInDb = onlyInDb
    .concat(dbCollectionItems.map((item) => constructCollectionId(item.name, item.version)));

  return { okCount, withConflicts, onlyInEs, onlyInDb };
}

exports.reconciliationReportForCollections = reconciliationReportForCollections;

async function getAllCollections() {
  const dbCollections = (await new Collection().getAllCollections())
    .map((collection) => constructCollectionId(collection.name, collection.version));

  const esCollectionsIterator = new ESSearchQueue(
    { sort_key: ['name', 'version'], fields: ['name', 'version'] }, 'collection', process.env.ES_INDEX
  );
  const esCollectins = (await esCollectionsIterator.empty())
    .map((item) => constructCollectionId(item.name, item.version));

  return union(dbCollections, esCollectins);
}

async function reportForGranulesByCollectionId(collectionId, recReportParams) {
  log.debug('internal-reconciliation-report reportForGranulesByCollectionId');
  //   For each collection,
  //     Get granule list in ES ordered by granuleId
  //     Get granule list in DynamoDB ordered by granuleId
  //   Report granules only in ES
  //   Report granules only in DynamoDB
  //   Report granules with different contents

  const searchParams = convertToGranuleSearchParams(recReportParams);
  const esGranulesIterator = new ESSearchQueue(
    { ...searchParams, collectionId, sort_key: ['granuleId'] }, 'granule', process.env.ES_INDEX
  );

  const dbGranulesIterator = await (new Granule())
    .searchGranulesForCollection(collectionId, searchParams);

  let okCount = 0;
  const withConflicts = [];
  const onlyInEs = [];
  const onlyInDb = [];
  const fieldsIgnored = ['timestamp', 'updatedAt'];

  const granuleFields = ['granuleId', 'collectionId', 'provider'];
  let [nextEsItem, nextDbItem] = await Promise.all([esGranulesIterator.peek(), dbGranulesIterator.peek()]); // eslint-disable-line max-len

  /* eslint-disable no-await-in-loop */
  while (nextEsItem && nextDbItem) {
    if (nextEsItem.granuleId < nextDbItem.granuleId) {
      // Found an item that is only in ES and not in DB
      onlyInEs.push(pick(nextEsItem, granuleFields));
      await esGranulesIterator.shift();
    } else if (nextEsItem.granuleId > nextDbItem.granuleId) {
      // Found an item that is only in DB and not in ES
      onlyInDb.push(pick(nextDbItem, granuleFields));
      await dbGranulesIterator.shift();
    } else {
      // Found an item that is in both ES and DB
      if (isEqual(omit(nextEsItem, fieldsIgnored), omit(nextDbItem, fieldsIgnored))) {
        okCount += 1;
      } else {
        withConflicts.push({ es: nextEsItem, db: nextDbItem });
      }
      await Promise.all([esGranulesIterator.shift(), dbGranulesIterator.shift()]);
    }

    [nextEsItem, nextDbItem] = await Promise.all([esGranulesIterator.peek(), dbGranulesIterator.peek()]); // eslint-disable-line max-len
  }

  // Add any remaining ES items to the report
  while (await esGranulesIterator.peek()) {
    const item = await esGranulesIterator.shift();
    onlyInEs.push(pick(item, granuleFields));
  }

  // Add any remaining DB items to the report
  while (await dbGranulesIterator.peek()) {
    const item = await dbGranulesIterator.shift();
    onlyInDb.push(pick(item, granuleFields));
  }
  /* eslint-enable no-await-in-loop */

  return { okCount, withConflicts, onlyInEs, onlyInDb };
}

/**
 * Compare the granule holdings in Elasticsearch with Database
 *
 * @param {Object} recReportParams - lambda's input filtering parameters to
 *                                   narrow limit of report.
 * @returns {Promise<Object>} an object with the okCount, onlyInEs, onlyInDb
 * and withConfilcts
 */
async function reconciliationReportForGranules(recReportParams) {
  log.debug('internal-reconciliation-report reconciliationReportForGranules');
  // To avoid 'scan' granules table, we query GSI in granules table with collectionId.
  // compare granule holdings:
  //   Get all collections list from db and es or use the collectionId from the request
  //   For each collection,
  //     compare granule holdings and get report
  //   Report granules only in ES
  //   Report granules only in DynamoDB
  //   Report granules with different contents

  const { collectionId, ...searchParams } = recReportParams;
  // get collections list in ES and dynamoDB combined
  const collections = collectionId ? [collectionId] : await getAllCollections();

  const concurrencyLimit = process.env.CONCURRENCY || 3;
  const limit = pLimit(concurrencyLimit);

  const reports = await Promise.all(collections.map((collection) => limit(() =>
    reportForGranulesByCollectionId(collection, searchParams))));

  const report = {};
  report.okCount = reports
    .reduce((accumulator, currentValue) => accumulator + currentValue.okCount, 0);
  report.withConflicts = reports
    .reduce((accumulator, currentValue) => accumulator.concat(currentValue.withConflicts), []);
  report.onlyInEs = reports
    .reduce((accumulator, currentValue) => accumulator.concat(currentValue.onlyInEs), []);
  report.onlyInDb = reports
    .reduce((accumulator, currentValue) => accumulator.concat(currentValue.onlyInDb), []);

  return report;
}

exports.reconciliationReportForGranules = reconciliationReportForGranules;

/**
 * Create a Internal Reconciliation report and save it to S3
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
async function createInternalReconciliationReport(recReportParams) {
  log.debug(`createInternalReconciliationReport parameters ${JSON.stringify(recReportParams)}`);
  const {
    createStartTime,
    endTimestamp,
    reportKey,
    startTimestamp,
    systemBucket,
  } = recReportParams;

  // Write an initial report to S3
  const initialReportFormat = {
    okCount: 0,
    withConflicts: [],
    onlyInEs: [],
    onlyInDb: [],
  };

  let report = {
    reportType: 'Internal',
    createStartTime: createStartTime.toISOString(),
    createEndTime: undefined,
    reportStartTime: startTimestamp,
    reportEndTime: endTimestamp,
    status: 'RUNNING',
    error: null,
    collections: cloneDeep(initialReportFormat),
    granules: cloneDeep(initialReportFormat),
  };

  await s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report),
  }).promise();

  const collectionsReport = await reconciliationReportForCollections(recReportParams);
  const granulesReport = await reconciliationReportForGranules(recReportParams);
  report = Object.assign(report, { collections: collectionsReport, granules: granulesReport });

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

exports.createInternalReconciliationReport = createInternalReconciliationReport;
