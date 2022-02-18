'use strict';

const omit = require('lodash/omit');
const { removeNilProperties } = require('@cumulus/common/util');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');

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

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for Elasticsearch collection search
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
 *
 * @param {Object} params - request params to convert to database params
 * @returns {Object} object of desired parameters formated for database collection search
 */
function convertToDBCollectionSearchParams(params) {
  const { collectionIds, startTimestamp, endTimestamp } = params;
  // doesn't support search with multiple collections
  const collection = collectionIds && collectionIds.length === 1
    ? deconstructCollectionId(collectionIds[0]) : {};
  const searchParams = {
    updatedAt__from: dateToValue(startTimestamp),
    updatedAt__to: dateToValue(endTimestamp),
    ...collection,
  };
  return removeNilProperties(searchParams);
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

/**
 *
 * @param {Object} params - request params to convert to database params
 * @returns {Object} object of desired parameters formated for database granule search
 */
function convertToDBGranuleSearchParams(params) {
  const {
    collectionIds: collectionId,
    granuleIds: granuleId,
    providers: provider,
    startTimestamp,
    endTimestamp,
  } = params;
  const searchParams = {
    updatedAt__from: dateToValue(startTimestamp),
    updatedAt__to: dateToValue(endTimestamp),
    collectionId,
    granuleId,
    provider,
  };
  return removeNilProperties(searchParams);
}

/**
 *
 * @param {Object} params - request params to convert to database params
 * @returns {Object} object of desired parameters formated for database granule search
 */
function convertToDBScanGranuleSearchParams(params) {
  const {
    collectionIds: collectionId,
    granuleIds: granuleIdsParam,
    providers: provider,
    status,
    startTimestamp,
    endTimestamp,
  } = params;
  const granuleId = (granuleIdsParam && (granuleIdsParam.length === 1))
    ? granuleIdsParam[0] : granuleIdsParam;

  const searchParams = {
    updatedAt__from: dateToValue(startTimestamp),
    updatedAt__to: dateToValue(endTimestamp),
    collectionId,
    granuleId,
    provider,
    status,
  };
  return removeNilProperties(searchParams);
}

/**
 * convert to es search parameters using createdAt for report time range
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for Elasticsearch.
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
 * @returns {Object} object of desired parameters formated for orca
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

module.exports = {
  cmrGranuleSearchParams,
  convertToDBCollectionSearchParams,
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParams,
  convertToDBGranuleSearchParams,
  convertToDBScanGranuleSearchParams,
  convertToESGranuleSearchParamsWithCreatedAtRange,
  convertToOrcaGranuleSearchParams,
  filterDBCollections,
  initialReportHeader,
  searchParamsForCollectionIdArray,
};
