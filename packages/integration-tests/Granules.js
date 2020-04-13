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

/**
 * Wait for a granule's status to be `completed` and return the granule
 *
 * @param {Object} params
 * @param {string} params.prefix - the name of the Cumulus stack
 * @param {string} params.granuleId - the `granuleId` of the granule
 * @param {Function} [params.callback=cumulusApiClient.invokeApifunction] - an async function to
 * invoke the API Lambda that takes a prefix / user payload
 * @param {integer} [params.timeout=30] - the number of seconds to wait for the
 *   execution to reach a terminal state
 * @returns {Promise<Object>} the granule as returned by the `GET /granules/<granule-id>` endpoint
 *
 * @alias module:Granules
 */
const getCompletedGranule = async (params = {}) =>
  pRetry(
    async () => {
      let granule;

      try {
        const response = await granulesApi.getGranule(
          pick(params, ['prefix', 'granuleId', 'callback'])
        );

        granule = JSON.parse(response.body);
      } catch (err) {
        throw new pRetry.AbortError(err);
      }

      if (granule.status === 'completed') return granule;

      if (granule.status === 'failed') {
        throw new pRetry.AbortError(
          new Error(`Granule ${params.granuleId} failed`)
        );
      }

      if (granule.statusCode === 404) {
        throw new pRetry.AbortError(
          new Error(`Granule ${params.granuleId} not found`)
        );
      }

      throw new Error(`Granule ${params.granuleId} still running`);
    },
    {
      retries: get(params, 'timeout', 30),
      maxTimeout: 1000
    }
  );

module.exports = {
  getCompletedGranule
};
