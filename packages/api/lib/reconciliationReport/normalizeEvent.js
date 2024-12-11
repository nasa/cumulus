//@ts-check

'use strict';

/*eslint prefer-const: ["error", {"destructuring": "all"}]*/
const isString = require('lodash/isString');
const { removeNilProperties } = require('@cumulus/common/util');
const { InvalidArgument, MissingRequiredArgument } = require('@cumulus/errors');

/**
 * @typedef {import('../types').RecReportParams } RecReportParams
 * @typedef {import('../types').NormalizedRecReportParams } NormalizedRecReportParams
 */

/**
 * ensures input reportType can be handled by the lambda code.
 *
 * @param {string} reportType
 * @returns {void} - if reportType is valid
 * @throws {InvalidArgument} - otherwise
 */
function validateReportType(reportType) {
  // List of valid report types handled by the lambda.
  const validReportTypes = [
    'Granule Inventory',
    'Granule Not Found',
    'Internal',
    'Inventory',
    'ORCA Backup',
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
 * @returns {string | undefined} - date formated as ISO timestamp;
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
 * Normalizes the input into an array of granule IDs.
 *
 * @param {string|string[]|undefined} granuleId - The granule ID or an array of granule IDs.
 * @returns {string[]|undefined} An array of granule IDs, or undefined if no granule ID is provided.
 */
function generateGranuleIds(granuleId) {
  return granuleId ? (isString(granuleId) ? [granuleId] : granuleId) : undefined;
}

/**
 * Transforms input collectionId into correct parameters for use in the
 * Reconciliation Report lambda.
 * @param {string[]|string | undefined} collectionId - list of collection Ids
 * @param {Object} modifiedEvent - input event
 * @returns {Object} updated input even with correct collectionId and collectionIds values.
 */
function updateCollectionIds(collectionId, modifiedEvent) {
  let returnEvent = { ...modifiedEvent };
  if (collectionId) {
    // transform input collectionId into an array on collectionIds
    const collectionIds = isString(collectionId) ? [collectionId] : collectionId;
    returnEvent = { ...modifiedEvent, collectionIds };
  }
  return returnEvent;
}

/**
 * Normalizes the input provider into an array of providers.
 *
 * @param {string|string[]|undefined} provider - The provider or list of providers.
 * @returns {string[]|undefined} An array of providers, or undefined if no provider is provided.
 */
function generateProviders(provider) {
  return provider ? (isString(provider) ? [provider] : provider) : undefined;
}

/**
 * Converts input parameters to normalized versions to pass on to the report
 * functions.  Ensures any input dates are formatted as ISO strings.
 *
 * @param {RecReportParams} event - input payload
 * @returns {NormalizedRecReportParams} - Object with normalized parameters
 */
function normalizeEvent(event) {
  const systemBucket = event.systemBucket || process.env.system_bucket;
  if (!systemBucket) {
    throw new MissingRequiredArgument('systemBucket is required.');
  }
  const stackName = event.stackName || process.env.stackName;
  if (!stackName) {
    throw new MissingRequiredArgument('stackName is required.');
  }
  const startTimestamp = isoTimestamp(event.startTimestamp);
  const endTimestamp = isoTimestamp(event.endTimestamp);

  const reportType = event.reportType || 'Inventory';
  validateReportType(reportType);

  let {
    collectionIds: anyCollectionIds,
    collectionId = undefined,
    granuleId = undefined,
    provider = undefined,
    ...modifiedEvent
  } = { ...event };
  if (anyCollectionIds) {
    throw new InvalidArgument('`collectionIds` is not a valid input key for a reconciliation report, use `collectionId` instead.');
  }

  const tooManyInputs = (collectionId && provider)
    || (granuleId && provider)
    || (granuleId && collectionId);
  const noInputLimitType = ['Internal', 'Granule Inventory', 'ORCA Backup'].includes(reportType);

  if (tooManyInputs && !noInputLimitType) {
    throw new InvalidArgument(`${reportType} reports cannot be launched with more than one input (granuleId, collectionId, or provider).`);
  }
  modifiedEvent = updateCollectionIds(collectionId, modifiedEvent);

  return (removeNilProperties({
    ...modifiedEvent,
    systemBucket,
    stackName,
    startTimestamp,
    endTimestamp,
    reportType,
    granuleIds: generateGranuleIds(granuleId),
    providers: generateProviders(provider),
  }));
}
exports.normalizeEvent = normalizeEvent;
