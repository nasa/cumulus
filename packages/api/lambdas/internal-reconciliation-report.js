'use strict';

const pick = require('lodash/pick');
const sortBy = require('lodash/sortBy');
const isEqual = require('lodash/isEqual');
const union = require('lodash/union');
const omit = require('lodash/omit');
const pLimit = require('p-limit');
const log = require('@cumulus/common/log');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { removeNilProperties } = require('@cumulus/common/util');
const { ESSearchQueue } = require('../es/esSearchQueue');
const { Collection, Granule } = require('../models');
const { deconstructCollectionId } = require('../lib/utils');

/**
 * @param {string} datestring - ISO timestamp string
 * @returns {number} - primitive value of input date.
 */
function ISODateToValue(datestring) {
  const primitiveDate = (new Date(datestring)).valueOf();
  return !Number.isNaN(primitiveDate) ? primitiveDate : undefined;
}

function convertToCollectionSearchParams(params) {
  const { collectionId, startTimestamp, endTimestamp } = params;
  const collection = collectionId ? deconstructCollectionId(collectionId) : {};
  const searchParams = {
    updatedAt__from: ISODateToValue(startTimestamp),
    updatedAt__to: ISODateToValue(endTimestamp),
    ...collection,
  };
  return removeNilProperties(searchParams);
}

function convertToGranuleSearchParams(params) {
  const { collectionId, granuleId, provider, startTimestamp, endTimestamp } = params;
  const searchParams = {
    updatedAt__from: ISODateToValue(startTimestamp),
    updatedAt__to: ISODateToValue(endTimestamp),
    collectionId,
    granuleId,
    provider,
  };
  return removeNilProperties(searchParams);
}

async function reconciliationReportForCollections(recReportParams) {
  log.debug('internal-reconciliation-report reconciliationReportForCollections');
  // compare collection holdings:
  //   Get collection list in ES ordered by granuleId
  //   Get collection list in DynamoDB ordered by granuleId
  //   Report collections only in ES
  //   Report collections only in DynamoDB
  //   Report collections with different contents

  const searchParams = convertToCollectionSearchParams(recReportParams);
  console.log('search param', searchParams);
  const esCollectionsIterator = new ESSearchQueue(
    { ...searchParams, sort_key: ['name', 'version'] }, 'collection', process.env.ES_INDEX
  );

  // get collections from database and sort them, since the scan result is not ordered
  const dbCollectionsQueue = await (new Collection()).searchCollections(searchParams);
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
    console.log(esCollectionId, dbCollectionId);
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

// export for testing
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

exports.getAllCollections = getAllCollections;

async function reportForGranulesByCollectionId(collectionId, recReportParams) {
  log.debug('internal-reconciliation-report reportForGranulesByCollectionId');
  //   For each collection,
  //     Get granule list in ES ordered by granuleId
  //     Get granule list in DynamoDB ordered by granuleId
  //   Report granules only in ES
  //   Report granules only in DynamoDB
  //   Report granules with different contents

  const searchParams = convertToGranuleSearchParams(recReportParams);
  console.log('search param', searchParams);
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
exports.reportForGranulesByCollectionId = reportForGranulesByCollectionId;

async function reconciliationReportForGranules(recReportParams) {
  log.debug('internal-reconciliation-report reconciliationReportForGranules');
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


// export for testing
exports.reconciliationReportForGranules = reconciliationReportForGranules;
