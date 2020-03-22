'use strict';

const pRetry = require('p-retry');
const Logger = require('@cumulus/logger');
const { invokeApi } = require('./cumulusApiClient');

const logger = new Logger({ sender: '@api-client/granules' });


/**
 * GET /granules/{granuleName}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
async function getGranule({ prefix, granuleId, callback = invokeApi }) {
  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/granules/${granuleId}`
    }
  });
}


/**
 * Wait for a granule to be present in the database (using pRetry)
 *
 * @param {Object} params             - params
 * @param {string} params.granuleId   - granuleId to wait for
 * @param {number} params.retries     - number of times to retry
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 */
async function waitForGranule({
  prefix, granuleId, retries = 10, callback = invokeApi
}) {
  await pRetry(
    async () => {
      const apiResult = await getGranule({ prefix, granuleId, callback });
      if (apiResult.statusCode === 500) {
        throw new pRetry.AbortError('API misconfigured/down/etc, failing test');
      }
      if (apiResult.statusCode !== 200) {
        throw new Error(`granule ${granuleId} not in database yet, status ${apiResult.statusCode} retrying....`);
      }
      logger.info(`Granule ${granuleId} in database, proceeding...`); // TODO fix logging
    },
    {
      retries,
      onFailedAttempt: async (e) => {
        logger.error(e.message);
      }
    }
  );
}

/**
 * Reingest a granule from the Cumulus API
 * PUT /granules/{}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
async function reingestGranule({ prefix, granuleId, callback = invokeApi }) {
  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/granules/${granuleId}`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'reingest' })
    }
  });
}

/**
 * Removes a granule from CMR via the Cumulus API
 * PUT /granules/{granuleId}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
async function removeFromCMR({ prefix, granuleId, callback = invokeApi }) {
  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/granules/${granuleId}`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'removeFromCmr' })
    }
  });
}

/**
 * Run a workflow with the given granule as the payload
 * PUT /granules/{granuleId}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {string} params.workflow    - workflow to be run with given granule
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
async function applyWorkflow({
  prefix,
  granuleId,
  workflow,
  callback = invokeApi
}) {
  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json'
      },
      path: `/granules/${granuleId}`,
      body: JSON.stringify({ action: 'applyWorkflow', workflow })
    }
  });
}

/**
 * Delete a granule from Cumulus via the API lambda
 * DELETE /granules/${granuleId}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the delete confirmation from the API
 */
async function deleteGranule({ prefix, granuleId, callback = invokeApi }) {
  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/granules/${granuleId}`
    }
  });
}

/**
 * Move a granule via the API
 * PUT /granules/{granuleId}
 *
 * @param {Object} params                       - params
 * @param {string} params.prefix                - the prefix configured for the stack
 * @param {string} params.granuleId             - a granule ID
 * @param {Array<Object>} params.destinations   - move granule destinations
 * @param {Function} params.callback            - async function to invoke the api lambda
 *                                                that takes a prefix / user payload.  Defaults
 *                                                to cumulusApiClient.invokeApifunction to invoke
 *                                                the api lambda
 * @returns {Promise<Object>}                   - the move response from the API
 */
async function moveGranule({
  prefix, granuleId, destinations, callback = invokeApi
}) {
  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json'
      },
      path: `/granules/${granuleId}`,
      body: JSON.stringify({ action: 'move', destinations })
    }
  });
}

/**
 * Removed a granule from CMR and delete from Cumulus via the API
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the delete confirmation from the API
 */
async function removePublishedGranule({ prefix, granuleId, callback = invokeApi }) {
  // pre-delete: Remove the granule from CMR
  await removeFromCMR({ prefix, granuleId, callback });
  return deleteGranule({ prefix, granuleId, callback });
}

async function listGranules({ prefix, query = null, callback = invokeApi }) {
  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/granules',
      body: query ? JSON.stringify({ query }) : undefined
    }
  });
}

module.exports = {
  getGranule,
  reingestGranule,
  removeFromCMR,
  applyWorkflow,
  deleteGranule,
  listGranules,
  moveGranule,
  waitForGranule,
  removePublishedGranule
};
