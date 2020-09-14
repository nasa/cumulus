'use strict';

const { removeNilProperties } = require('@cumulus/common/util');
const { deconstructCollectionId } = require('./utils');
/**
 * @param {string} dateable - any input valid for a JS Date contstructor.
 * @returns {number} - primitive value of input date string or undefined, if
 *                     input string not convertable.
 */
function dateToValue(dateable) {
  const primitiveDate = (new Date(dateable)).valueOf();
  return !Number.isNaN(primitiveDate) ? primitiveDate : undefined;
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for Elasticsearch collection search
 */
function convertToESCollectionSearchParams(params) {
  const { collectionId, startTimestamp, endTimestamp, provider } = params;
  const collection = collectionId ? deconstructCollectionId(collectionId) : {};
  const searchParams = {
    updatedAt__from: dateToValue(startTimestamp),
    updatedAt__to: dateToValue(endTimestamp),
    ...collection,
    provider,
  };
  return removeNilProperties(searchParams);
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for Elasticsearch.
 */
function convertToESGranuleSearchParams(params) {
  const { collectionId, provider } = params;
  return removeNilProperties({
    updatedAt__from: dateToValue(params.startTimestamp),
    updatedAt__to: dateToValue(params.endTimestamp),
    collectionId,
    provider,
  });
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch/DB params
 * @returns {Object} object of desired parameters formated for Elasticsearch/DB
 */
function convertToGranuleSearchParams(params) {
  const { collectionId, granuleId, provider, startTimestamp, endTimestamp } = params;
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
    collectionId,
  } = recReportParams;

  return {
    reportType,
    createStartTime: createStartTime.toISOString(),
    createEndTime: undefined,
    reportStartTime: startTimestamp,
    reportEndTime: endTimestamp,
    status: 'RUNNING',
    error: undefined,
    collectionId,
  };
}

/**
 * Simple converter from input reportParams to CMR searchCollection params.
 * e.g.:
 * {collectionId: "name__version"} => {short_name: 'name', version: 'version'}
 * @param {Object} reportParams
 * @returns {Object} correct paremeters to call cmr.searchCollection with.
 */
function cmrSearchParams(reportParams) {
  const { collectionId } = reportParams;
  const { name, version } = collectionId ? deconstructCollectionId(collectionId) : {};
  const collection = { short_name: name, version };
  return removeNilProperties(collection);
}

module.exports = {
  cmrSearchParams,
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParams,
  convertToGranuleSearchParams,
  initialReportHeader,
};
