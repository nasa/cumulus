//@ts-check

'use strict';

const { removeNilProperties } = require('@cumulus/common/util');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');
const Logger = require('@cumulus/logger');

const log = new Logger({ sender: '@api/lambdas/create-reconciliation-report' });

/**
 * @typedef {import('../lib/types').RecReportParams } RecReportParams
 * @typedef {import('../lib/types').EnhancedNormalizedRecReportParams }
 * EnhancedNormalizedRecReportParams
 * @typedef {import('../lib/types').NormalizedRecReportParams } NormalizedRecReportParams
 * @typedef {import('./reconciliationReport-types').ReportHeader } ReportHeader
 */

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
 * @param {string} dateable - any input valid for a JS Date contstructor.
 * @returns {number | undefined} - primitive value of input date string or undefined, if
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

/**
 * convertToDBCollectionSearchObject      - Creates Postgres search object from
 *                                          InternalRecReport Parameters
 * @param {Object} params                 - request params to convert to database params
 * @param {string[]} [params.collectionIds] - List containing single Collection object
 *                                          multiple or no collections will result in a
 *                                          search object without a collection object
 * @param {string} [params.endTimestamp]    - ending report datetime ISO Timestamp
 * @param {string} [params.startTimestamp]  - beginning report datetime ISO timestamp
 * @returns {Object[]}                    - array of objects of desired
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
 * Convert reconciliation report parameters to PostgreSQL database search params.
 *
 * @param {EnhancedNormalizedRecReportParams} params - request params to convert to database params
 * @returns object of desired parameters formatted for database granule search
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
 * @param {EnhancedNormalizedRecReportParams} recReportParams - params
 * @returns {ReportHeader} report header
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
  convertToDBCollectionSearchObject,
  convertToDBGranuleSearchParams,
  convertToOrcaGranuleSearchParams,
  filterDBCollections,
  initialReportHeader,
};
