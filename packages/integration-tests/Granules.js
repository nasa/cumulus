'use strict';

/**
 * @module Granules
 *
 * @example
 * const Granules = require('@cumulus/integration-test/Granules');
 */

const get = require('lodash/get');
const granulesApi = require('@cumulus/api-client/granules');
const pick = require('lodash/pick');
const pRetry = require('p-retry');

class GranuleNotFoundError extends Error {
  constructor(id) {
    super(`Granule ${id} not found`);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
  }
}

const getGranule = async (params) => {
  const response = await granulesApi.getGranule(
    pick(params, ['prefix', 'granuleId', 'callback'])
  );

  if (response.status === 404) throw new GranuleNotFoundError(params.granuleId);

  return JSON.parse(response.body);
};

/**
 * Wait for a granule to have an expected status and return the granule
 *
 * @param {Object} params
 * @param {string} params.prefix - the name of the Cumulus stack
 * @param {string} params.granuleId - the `granuleId` of the granule
 * @param {string} params.status - the status to wait for
 * @param {Function} [params.callback=cumulusApiClient.invokeApifunction] - an async function to
 * invoke the API Lambda that takes a prefix / user payload
 * @param {integer} [params.timeout=30] - the number of seconds to wait for the
 *   execution to reach a terminal state
 * @returns {Promise<Object>} the granule as returned by the `GET /granules/<granule-id>` endpoint
 *
 * @alias module:Granules
 */
const getGranuleWithStatus = async (params = {}) =>
  pRetry(
    async () => {
      let granule;

      try {
        granule = await getGranule(pick(params, ['prefix', 'granuleId', 'callback']));
      } catch (error) {
        throw new pRetry.AbortError(error);
      }

      if (granule.status === params.status) return granule;

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
      maxTimeout: 1000,
    }
  );

module.exports = {
  getGranuleWithStatus,
};
