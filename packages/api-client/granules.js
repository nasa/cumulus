'use strict';

const { invokeApi } = require('./cumulusApiClient');

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
const getGranule = async ({ prefix, granuleId, callback = invokeApi }) => callback({
  prefix: prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: `/granules/${granuleId}`
  }
});

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
const reingestGranule = async ({ prefix, granuleId, callback = invokeApi }) => callback({
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
const removeFromCMR = async ({ prefix, granuleId, callback = invokeApi }) => callback({
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
const applyWorkflow = async ({
  prefix,
  granuleId,
  workflow,
  callback = invokeApi
}) => callback({
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
const deleteGranule = ({ prefix, granuleId, callback = invokeApi }) =>
  callback({
    prefix: prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/granules/${granuleId}`
    }
  });

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
const moveGranule = async ({
  prefix, granuleId, destinations, callback = invokeApi
}) => callback({
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
const removePublishedGranule = async ({ prefix, granuleId, callback = invokeApi }) => {
  // pre-delete: Remove the granule from CMR
  await removeFromCMR({ prefix, granuleId, callback });
  return deleteGranule({ prefix, granuleId, callback });
};

/**
 * Query  granules stored in cumulus
 * GET /granules
 * @param {Object} params             - params
 * @param {string} params.query       - query to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
const listGranules = async ({ prefix, query = null, callback = invokeApi }) => callback({
  prefix: prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: '/granules',
    body: query ? JSON.stringify({ query }) : undefined
  }
});

module.exports = {
  getGranule,
  reingestGranule,
  removeFromCMR,
  applyWorkflow,
  deleteGranule,
  listGranules,
  moveGranule,
  removePublishedGranule
};
