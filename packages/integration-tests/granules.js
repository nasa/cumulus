'use strict';

const pick = require('lodash/pick');
const pRetry = require('p-retry');
const granulesApi = require('@cumulus/api-client/granules');

/**
 * Wait for a granule to be completed and return it
 *
 * @param {Object} params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - the granule id
 * @param {Function} params.callback - an async function to invoke the api
 *   lambda that takes a prefix / user payload. Defaults to
 *   cumulusApiClient.invokeApifunction to invoke the api lambda
 * @param {integer} params.timeout - the number of seconds to wait for the
 *   execution to reach a terminal state
 * @returns {Promise<undefined>}
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

      // TODO Handle the case where the granule does not exist

      if (granule.status === 'completed') return granule;

      if (granule.status === 'failed') {
        throw new pRetry.AbortError(
          new Error(`Granule ${params.granuleId} failed`)
        );
      }

      throw new Error(`Granule ${params.granuleId} still running`);
    },
    {
      retries: params.timeout,
      maxTimeout: 1000
    }
  );

module.exports = {
  getCompletedGranule
};
