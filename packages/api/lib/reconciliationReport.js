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
 * @param {Object} params - request params to convert to reconciliationReportForCollection params
 * @returns {Object} object of desired parameters formated for Elasticsearch.
 */
function convertToESCollectionSearchParams(params) {
  return {
    updatedAt__from: dateToValue(params.startTimestamp),
    updatedAt__to: dateToValue(params.endTimestamp),
  };
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for Elasticsearch.
 */
function convertToESGranuleSearchParams(params) {
  return {
    updatedAt__from: dateToValue(params.startTimestamp),
    updatedAt__to: dateToValue(params.endTimestamp),
  };
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch/DB params
 * @returns {Object} object of desired parameters formated for Elasticsearch/DB
 */
function convertToCollectionSearchParams(params) {
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

module.exports = {
  convertToCollectionSearchParams,
  convertToGranuleSearchParams,
  convertToESGranuleSearchParams,
  convertToESCollectionSearchParams,
};
