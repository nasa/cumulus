'use strict';

const isEqual = require('lodash/isEqual');
const omit = require('lodash/omit');

const { removeNilProperties } = require('@cumulus/common/util');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');
const Logger = require('@cumulus/logger');

const log = new Logger({ sender: '@api/lambdas/create-reconciliation-report' });

/**
 * Extra search params to add to the cmrGranules searchConceptQueue
 *
 * @param {Object} recReportParams - input report params
 * @returns {Array<Array>} array of name/value pairs to add to the search params
 */
function cmrGranuleSearchParams(recReportParams) {
  const { granuleIds } = recReportParams;
  if (granuleIds) {
    return granuleIds.map((gid) => ['readable_granule_name[]', gid]);
  }
  return [];
}

// TODO: remove
/**
 * Prepare a list of collectionIds into an _id__in object
 *
 * @param {Array<string>} collectionIds - Array of collectionIds in the form 'name___ver'
 * @returns {Object} - object that will return the correct terms search when
 *                     passed to the query command.
 */
function searchParamsForCollectionIdArray(collectionIds) {
  return { _id__in: collectionIds.join(',') };
}

/**
 * @param {string} dateable - any input valid for a JS Date contstructor.
 * @returns {number} - primitive value of input date string or undefined, if
 *                     input string not convertable.
 */
function dateToValue(dateable) {
  const primitiveDate = new Date(dateable).valueOf();
  return !Number.isNaN(primitiveDate) ? primitiveDate : undefined;
}

function dateStringToDateOrNull(dateable) {
  const date = new Date(dateable);
  return !Number.isNaN(date.valueOf()) ? date : undefined;
}

//TODO Verify this function is still needed
/**
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formatted for Elasticsearch collection search
 */
function convertToESCollectionSearchParams(params) {
  const { collectionIds, startTimestamp, endTimestamp } = params;
  const idsIn = collectionIds
    ? searchParamsForCollectionIdArray(collectionIds)
    : undefined;
  const searchParams = {
    updatedAt__from: dateToValue(startTimestamp),
    updatedAt__to: dateToValue(endTimestamp),
    ...idsIn,
  };
  return removeNilProperties(searchParams);
}

/**
 * convertToDBCollectionSearchObject      - Creates Postgres search object from
 *                                          InternalRecReport Parameters
 * @param {Object} params                 - request params to convert to database params
 * @param {[Object]} params.collectionIds - List containing single Collection object
 *                                          multiple or no collections will result in a
 *                                          search object without a collection object
 * @param {moment} params.endTimestamp    - ending report datetime ISO Timestamp
 * @param {moment} params.startTimestamp  - beginning report datetime ISO timestamp
 * @returns {[Object]}                    - array of objects of desired
 *                                          parameters formatted for database collection
 *                                          search
 */
function convertToDBCollectionSearchObject(params) {
  const { collectionIds, startTimestamp, endTimestamp } = params;
  // doesn't support search with multiple collections
  let collection = {};
  if (collectionIds && collectionIds.length === 1) {
    collection = deconstructCollectionId(collectionIds[0]);
  } else {
    log.info(`Multiple or no collections passed to convertToDBCollectionSearchObject ${JSON.stringify(params)}`);
  }
  const searchParams = [
    {
      updatedAtFrom: dateStringToDateOrNull(startTimestamp),
      updatedAtTo: dateStringToDateOrNull(endTimestamp),
    },
    removeNilProperties(collection),
  ];
  return searchParams;
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for Elasticsearch.
 */
function convertToESGranuleSearchParams(params) {
  const { collectionIds, granuleIds, providers, startTimestamp, endTimestamp } = params;
  const collectionIdIn = collectionIds ? collectionIds.join(',') : undefined;
  const granuleIdIn = granuleIds ? granuleIds.join(',') : undefined;
  const providerIn = providers ? providers.join(',') : undefined;
  return removeNilProperties({
    updatedAt__from: dateToValue(startTimestamp),
    updatedAt__to: dateToValue(endTimestamp),
    collectionId__in: collectionIdIn,
    granuleId__in: granuleIdIn,
    provider__in: providerIn,
  });
}


// TODO - type this
/**
 * Convert reconciliation report parameters to PostgreSQL database search params.
 *
 * @param {Object} params - request params to convert to database params
 * @returns {Object} object of desired parameters formated for database granule search
 */
function convertToDBGranuleSearchParams(params) {
  const {
    collectionIds,
    granuleIds,
    providers,
    startTimestamp,
    endTimestamp,
    status,
  } = params;
  const searchParams = {
    collectionIds,
    granuleIds,
    providerNames: providers,
    status,
  };
  if (startTimestamp || endTimestamp) {
    searchParams.updatedAtRange = removeNilProperties({
      updatedAtFrom: startTimestamp ? new Date(startTimestamp) : undefined,
      updatedAtTo: endTimestamp ? new Date(endTimestamp) : undefined,
    });
  }
  return removeNilProperties(searchParams);
}

/**
 * convert to es search parameters using createdAt for report time range
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formatted for Elasticsearch.
 */
function convertToESGranuleSearchParamsWithCreatedAtRange(params) {
  const searchParamsWithUpdatedAt = convertToESGranuleSearchParams(params);
  const searchParamsWithCreatedAt = {
    createdAt__from: searchParamsWithUpdatedAt.updatedAt__from,
    createdAt__to: searchParamsWithUpdatedAt.updatedAt__to,
    ...omit(searchParamsWithUpdatedAt, ['updatedAt__from', 'updatedAt__to']),
  };
  return removeNilProperties(searchParamsWithCreatedAt);
}

/**
 *
 * @param {Object} params - request params to convert to orca params
 * @returns {Object} object of desired parameters formatted for orca
 */
function convertToOrcaGranuleSearchParams(params) {
  const { collectionIds, granuleIds, providers, startTimestamp, endTimestamp } = params;
  return removeNilProperties({
    startTimestamp: dateToValue(startTimestamp),
    endTimestamp: dateToValue(endTimestamp) || Date.now(),
    collectionId: collectionIds,
    granuleId: granuleIds,
    providerId: providers,
  });
}

/**
 * create initial report header
 *
 * @param {Object} recReportParams - params
 * @param {Object} recReportParams.reportType - the report type
 * @param {moment} recReportParams.createStartTime - when the report creation was begun
 * @param {moment} recReportParams.endTimestamp - ending report datetime ISO Timestamp
 * @param {moment} recReportParams.startTimestamp - beginning report datetime ISO timestamp
 * @returns {Object} report header
 */
function initialReportHeader(recReportParams) {
  const {
    reportType,
    createStartTime,
    endTimestamp,
    startTimestamp,
    granuleIds,
    granuleId,
    collectionIds,
    collectionId,
    provider,
    providers,
    location,
  } = recReportParams;

  return {
    collectionId,
    collectionIds,
    createEndTime: undefined,
    createStartTime: createStartTime.toISOString(),
    error: undefined,
    granuleId,
    granuleIds,
    provider,
    providers,
    location,
    reportEndTime: endTimestamp,
    reportStartTime: startTimestamp,
    reportType,
    status: 'RUNNING',
  };
}

/**
 * filters the returned database collections by the desired collectionIds
 *
 * @param {Array<Object>} collections - database collections
 * @param {Object} recReportParams - input report params
 * @param {Array<string>} recReportParams.collectionIds - array of collectionIds to keep
 * @returns {Array<string>} filtered list of collectionIds returned from database
 */
function filterDBCollections(collections, recReportParams) {
  const { collectionIds } = recReportParams;

  if (collectionIds) {
    return collections.filter((collection) =>
      collectionIds.includes(constructCollectionId(collection.name, collection.version)));
  }
  return collections;
}

/**
 * Compare granules from Elasticsearch and API for deep equality.
 *
 * @param {Object} esGranule - Granule from Elasticsearch
 * @param {Object} apiGranule - API Granule (translated from PostgreSQL)
 * @returns {boolean}
 */
function compareEsGranuleAndApiGranule(esGranule, apiGranule) {
  // Ignore files in initial comparison so we can ignore file order
  // in comparison
  const fieldsIgnored = ['timestamp', 'updatedAt', 'files'];
  // "dataType" and "version" fields do not exist in the PostgreSQL database
  // granules table which is now the source of truth
  const esFieldsIgnored = [...fieldsIgnored, 'dataType', 'version'];
  const granulesAreEqual = isEqual(
    omit(esGranule, esFieldsIgnored),
    omit(apiGranule, fieldsIgnored)
  );

  if (granulesAreEqual === false) return granulesAreEqual;

  const esGranulesHasFiles = esGranule.files !== undefined;
  const apiGranuleHasFiles = apiGranule.files.length !== 0;

  // If neither granule has files, then return the previous equality result
  if (!esGranulesHasFiles && !apiGranuleHasFiles) return granulesAreEqual;
  // If either ES or PG granule does not have files, but the other granule does
  // have files, then the granules don't match, so return false
  if ((esGranulesHasFiles && !apiGranuleHasFiles)
      || (!esGranulesHasFiles && apiGranuleHasFiles)) {
    return false;
  }

  // Compare files one-by-one to ignore sort order for comparison
  return esGranule.files.every((esFile) => {
    const matchingFile = apiGranule.files.find(
      (apiFile) => apiFile.bucket === esFile.bucket && apiFile.key === esFile.key
    );
    if (!matchingFile) return false;
    return isEqual(esFile, matchingFile);
  });
}

module.exports = {
  cmrGranuleSearchParams,
  convertToDBCollectionSearchObject,
  convertToDBGranuleSearchParams,
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParams,
  convertToESGranuleSearchParamsWithCreatedAtRange,
  convertToOrcaGranuleSearchParams,
  filterDBCollections,
  initialReportHeader,
  searchParamsForCollectionIdArray,
  compareEsGranuleAndApiGranule,
};
