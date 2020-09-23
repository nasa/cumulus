'use strict';

/*eslint prefer-const: ["error", {"destructuring": "all"}]*/
const isString = require('lodash/isString');
const { removeNilProperties } = require('@cumulus/common/util');
const { InvalidArgument } = require('@cumulus/errors');

/**
 * ensures input reportType can be handled by the lambda code.
 *
 * @param {string} reportType
 * @returns {undefined} - if reportType is valid
 * @throws {InvalidArgument} - otherwise
 */
function validateReportType(reportType) {
  // List of valid report types handled by the lambda.
  const validReportTypes = [
    'Granule Inventory',
    'Granule Not Found',
    'Internal',
    'Inventory',
  ];
  if (!validReportTypes.includes(reportType)) {
    throw new InvalidArgument(
      `${reportType} is not a valid report type. Please use one of ${JSON.stringify(validReportTypes)}.`
    );
  }
}

/**
 * Convert input to an ISO timestamp.
 * @param {any} dateable - any type convertable to JS Date
 * @returns {string} - date formated as ISO timestamp;
 */
function isoTimestamp(dateable) {
  if (dateable) {
    const aDate = new Date(dateable);
    if (Number.isNaN(aDate.valueOf())) {
      throw new TypeError(`${dateable} is not a valid input for new Date().`);
    }
    return aDate.toISOString();
  }
  return undefined;
}

/**
 * Transforms input granuleId into correct parameters for use in the
 * Reconciliation Report lambda.
 * @param {Array<string>|string} granuleId - list of granule Ids
 * @param {string} reportType - report type
 * @param {Object} modifiedEvent - input event
 * @returns {Object} updated input even with correct granuleId and granuleIds values.
 */
function updateGranuleIds(granuleId, reportType, modifiedEvent) {
  let returnEvent = { ...modifiedEvent };
  if (granuleId) {
    // transform input granuleId into an array on granuleIds
    const granuleIds = isString(granuleId) ? [granuleId] : granuleId;
    if (reportType === 'Internal') {
      if (!isString(granuleId)) {
        throw new InvalidArgument(`granuleId: ${JSON.stringify(granuleId)} is not valid input for an 'Internal' report.`);
      } else {
        // include both granuleId and granuleIds for Internal Reports.
        returnEvent = { ...modifiedEvent, granuleId, granuleIds: [granuleId] };
      }
    } else {
      returnEvent = { ...modifiedEvent, granuleIds };
    }
  }
  return returnEvent;
}

/**
 * Transforms input collectionId into correct parameters for use in the
 * Reconciliation Report lambda.
 * @param {Array<string>|string} collectionId - list of collection Ids
 * @param {string} reportType - report type
 * @param {Object} modifiedEvent - input event
 * @returns {Object} updated input even with correct collectionId and collectionIds values.
 */
function updateCollectionIds(collectionId, reportType, modifiedEvent) {
  let returnEvent = { ...modifiedEvent };
  if (collectionId) {
    const collectionIds = isString(collectionId) ? [collectionId] : collectionId;
    if (reportType === 'Internal') {
      if (!isString(collectionId)) {
        throw new InvalidArgument(`collectionId: ${JSON.stringify(collectionId)} is not valid input for an 'Internal' report.`);
      } else {
        // include both collectionIds and collectionId for Internal Reports.
        returnEvent = { ...modifiedEvent, collectionId, collectionIds: [collectionId] };
      }
    } else {
      // add array of collectionIds
      returnEvent = { ...modifiedEvent, collectionIds };
    }
  }
  return returnEvent;
}

/**
 * Converts input parameters to normalized versions to pass on to the report
 * functions.  Ensures any input dates are formatted as ISO strings.
 *
 * @param {Object} event - input payload
 * @returns {Object} - Object with normalized parameters
 */
function normalizeEvent(event) {
  const systemBucket = event.systemBucket || process.env.system_bucket;
  const stackName = event.stackName || process.env.stackName;
  const startTimestamp = isoTimestamp(event.startTimestamp);
  const endTimestamp = isoTimestamp(event.endTimestamp);

  const reportType = event.reportType || 'Inventory';
  validateReportType(reportType);

  // TODO [MHS, 09/08/2020] Clean this up when CUMULUS-2156 is worked/completed
  // for now, move input collectionId to collectionIds as array
  // internal reports will keep existing collectionId and copy it to collectionIds
  let { collectionIds: anyCollectionIds, collectionId, granuleId, ...modifiedEvent } = { ...event };
  if (anyCollectionIds) {
    throw new InvalidArgument('`collectionIds` is not a valid input key for a reconciliation report, use `collectionId` instead.');
  }
  if (granuleId && collectionId && reportType !== 'Internal') {
    throw new InvalidArgument(`${reportType} reports cannot be launched with both granuleId and collectionId input.`);
  }
  modifiedEvent = updateCollectionIds(collectionId, reportType, modifiedEvent);
  modifiedEvent = updateGranuleIds(granuleId, reportType, modifiedEvent);

  return removeNilProperties({
    ...modifiedEvent,
    systemBucket,
    stackName,
    startTimestamp,
    endTimestamp,
    reportType,
  });
}
exports.normalizeEvent = normalizeEvent;
