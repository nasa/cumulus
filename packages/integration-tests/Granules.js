'use strict';

/**
 * @module Granules
 *
 * @example
 * const Granules = require('@cumulus/integration-test/Granules');
 */

const get = require('lodash/get');
const pick = require('lodash/pick');
const pRetry = require('p-retry');

const granulesApi = require('@cumulus/api-client/granules');

class GranuleNotFoundError extends Error {
  constructor(id) {
    super(`Granule ${id} not found`);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
  }
}

const getGranule = async (params) => {
  const response = await granulesApi.getGranuleResponse(
    pick(params, ['prefix', 'granuleId', 'callback', 'collectionId'])
  );

  if (response.status === 404) throw new GranuleNotFoundError(params.granuleId);

  return JSON.parse(response.body);
};

/**
 * Wait for a granule to have an expected status and return the granule
 *
 * @param {Object} params
 * @param {string} params.prefix    - the name of the Cumulus stack
 * @param {string} params.granuleId - the `granuleId` of the granule
 * @param {string} params.collectionId - the `collectionId` of the granule
 * @param {string} params.status    - the status to wait for
 * @param {string} params.updatedAt - minimum updatedAt time the granule must have to return
 * @param {Function} [params.callback=cumulusApiClient.invokeApifunction] - an async function to
 * invoke the API Lambda that takes a prefix / user payload
 * @param {integer} [params.timeout=30] - the number of seconds to wait for the
 *   execution to reach a terminal state
 * @returns {Promise<Object>} the granule as returned by the `GET /granules/<granule-id>` endpoint
 *
 * @alias module:Granules
 */
const getGranuleWithStatus = async (params = {}) =>
  await pRetry(
    async () => {
      let granule;
      const updatedAt = params.updatedAt || 0;

      try {
        granule = await getGranule(pick(params, ['prefix', 'granuleId', 'callback', 'collectionId']));
      } catch (error) {
        throw new pRetry.AbortError(error);
      }

      if (granule.status === params.status && granule.updatedAt > updatedAt) return granule;
      if (['completed', 'failed'].includes(granule.status)) {
        throw new pRetry.AbortError(
          new Error(
            `Expected granule ${params.granuleId} to have status ${params.status} but found ${granule.status}`
          )
        );
      }

      throw new Error(`Granule ${params.granuleId} still running`);
    },
    {
      retries: get(params, 'timeout', 30),
      maxTimeout: 2000,
    }
  );

/**
 * Wait for listGranules to return at least a single value before returning an
 * empty result
 * @param {Object} params - parameters to listGranules function
 * @returns {Promise<Object>} - results of a successful listGranules
 */
const waitForListGranulesResult = async (params) => await pRetry(
  async () => {
    const results = await granulesApi.listGranules(params);
    if (results.body && JSON.parse(results.body).results.length > 0) return results;
    throw new Error('Waiting for searched Granule.');
  }
);

module.exports = {
  getGranuleWithStatus,
  waitForListGranulesResult,
};
