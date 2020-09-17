'use strict';

const { removeNilProperties } = require('@cumulus/common/util');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { deconstructCollectionId } = require('./utils');

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
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for Elasticsearch collection search
 */
function convertToDBCollectionSearchParams(params) {
  const { collectionId, startTimestamp, endTimestamp } = params;
  const collection = collectionId ? deconstructCollectionId(collectionId) : {};
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
  const providersIn = providers ? providers.join(',') : undefined;
  return removeNilProperties({
    updatedAt__from: dateToValue(startTimestamp),
    updatedAt__to: dateToValue(endTimestamp),
    collectionId__in: collectionIdIn,
    granuleId__in: granuleIdIn,
    provider__in: providersIn,
  });
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch/DB params
 * @returns {Object} object of desired parameters formated for Elasticsearch/DB
 */
function convertToGranuleSearchParams(params) {
  const {
    collectionId,
    granuleId,
    provider,
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
  } = recReportParams;

  return {
    collectionId,
    collectionIds,
    createEndTime: undefined,
    createStartTime: createStartTime.toISOString(),
    error: undefined,
    granuleId,
    granuleIds,
    reportEndTime: endTimestamp,
    reportStartTime: startTimestamp,
    reportType,
    status: 'RUNNING',
  };
}

/**
 * filters the returned UMM CMR collections by the desired collectionIds
 *
 * @param {Array<Object>} collections - CMR.searchCollections result
 * @param {Object} recReportParams
 * @param {Array<string>} recReportParams.collectionIds - array of collectionIds to keep
 * @returns {Array<string>} filtered list of collectionIds returned from CMR
 */
function filterCMRCollections(collections, recReportParams) {
  const { collectionIds } = recReportParams;

  const CMRCollectionIds = collections
    .map((item) => constructCollectionId(item.umm.ShortName, item.umm.Version))
    .sort();

  if (!collectionIds) return CMRCollectionIds;

  return CMRCollectionIds.filter((item) => collectionIds.includes(item));
}

module.exports = {
  cmrGranuleSearchParams,
  convertToDBCollectionSearchParams,
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParams,
  convertToGranuleSearchParams,
  filterCMRCollections,
  initialReportHeader,
  searchParamsForCollectionIdArray,
};
