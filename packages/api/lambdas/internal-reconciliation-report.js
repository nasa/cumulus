'use strict';

const sortBy = require('lodash/sortBy');
const isEqual = require('lodash/isEqual');
const union = require('lodash/union');
const omit = require('lodash/omit');
const log = require('@cumulus/common/log');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { removeNilProperties } = require('@cumulus/common/util');
const { ESSearchQueue } = require('../es/esSearchQueue');
const { Collection } = require('../models');
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
  const itemsWithConflicts = [];
  let itemsOnlyInEs = [];
  let itemsOnlyInDb = [];

  let nextEsItem = await esCollectionsIterator.peek();
  let nextDbItem = (dbCollectionItems.length !== 0) ? dbCollectionItems[0] : null;

  while (nextEsItem && nextDbItem) {
    const esCollectionId = constructCollectionId(nextEsItem.name, nextEsItem.version);
    const dbCollectionId = constructCollectionId(nextDbItem.name, nextDbItem.version);
    console.log(esCollectionId, dbCollectionId);
    if (esCollectionId < dbCollectionId) {
      // Found an item that is only in ES and not in DB
      itemsOnlyInEs.push(esCollectionId);
      await esCollectionsIterator.shift(); // eslint-disable-line no-await-in-loop
    } else if (esCollectionId > dbCollectionId) {
      // Found an item that is only in DB and not in ES
      itemsOnlyInDb.push(dbCollectionId);
      dbCollectionItems.shift();
    } else {
      // Found an item that is in both cmr and database
      if (isEqual(omit(nextEsItem, ['timestamp', 'updatedAt']), omit(nextDbItem, ['timestamp', 'updatedAt']))) {
        okCount += 1;
      } else {
        itemsWithConflicts.push({ es: nextEsItem, db: nextDbItem });
      }
      esCollectionsIterator.shift();
      dbCollectionItems.shift();
    }

    nextEsItem = await esCollectionsIterator.peek(); // eslint-disable-line no-await-in-loop
    nextDbItem = (dbCollectionItems.length !== 0) ? dbCollectionItems[0] : null;
  }

  // Add any remaining ES items to the report
  itemsOnlyInEs = itemsOnlyInEs.concat(
    (await esCollectionsIterator.empty())
      .map((item) => constructCollectionId(item.name, item.version))
  );

  // Add any remaining DB items to the report
  itemsOnlyInDb = itemsOnlyInDb
    .concat(dbCollectionItems.map((item) => constructCollectionId(item.name, item.version)));

  return {
    okCount,
    conflicts: itemsWithConflicts,
    onlyInEs: itemsOnlyInEs,
    onlyInDb: itemsOnlyInDb,
  };
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

async function reconciliationReportForGranules(recReportParams) {
  log.debug('internal-reconciliation-report reconciliationReportForGranules');
  // compare granule holdings:
  //   Get all collections list from db and es
  //   For each collection,
  //     Get granule list in ES ordered by granuleId
  //     Get granule list in DynamoDB ordered by granuleId
  //   Report granules only in ES
  //   Report granules only in DynamoDB
  //   Report granules with different contents

  // get collections list in ES and dynamoDB combined
  const collections = getAllCollections();
  return {};
}

async function reconciliationReportForGranulesByCollection(collectionId, recReportParams) {
  log.debug('internal-reconciliation-report reconciliationReportForGranules');
  // compare granule holdings:
  //   Get all collections list from db and es
  //   For each collection,
  //     Get granule list in ES ordered by granuleId
  //     Get granule list in DynamoDB ordered by granuleId
  //   Report granules only in ES
  //   Report granules only in DynamoDB
  //   Report granules with different contents

  // get collections list in ES and dynamoDB combined
  const collections = getAllCollections();
  return {};
}

// export for testing
exports.reconciliationReportForGranules = reconciliationReportForGranules;
