'use strict';

const { deprecate } = require('@cumulus/common/util');
const granulesApi = require('@cumulus/api-client/granules');


/**
 * GET /granules/{granuleName}
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function getGranule(params) {
  deprecate('@cumulus/integration-tests/granulesApi.getGranule', '1.20.0', '@cumulus/cumulus-api-client/granules.getGranule');
  return granulesApi.getGranule(params);
}


async function waitForGranule(params) {
  deprecate('@cumulus/integration-tests/granulesApi.waitForGranule', '1.20.0', '@cumulus/cumulus-api-client/granules.waitForGranule');
  return granulesApi.waitForGranule(params);
}

/**
 * Reingest a granule from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function reingestGranule(params) {
  deprecate('@cumulus/integration-tests/granulesApi.reingestGranule', '1.20.0', '@cumulus/cumulus-api-client/granules.reingestGranule');
  return granulesApi.reingestGranule(params);
}

/**
 * Removes a granule from CMR via the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function removeFromCMR(params) {
  deprecate('@cumulus/integration-tests/granulesApi.removeFromCMR', '1.20.0', '@cumulus/cumulus-api-client/granules.removeFromCMR');
  return granulesApi.removeFromCMR(params);
}

/**
 * Run a workflow with the given granule as the payload
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @param {string} params.workflow - workflow to be run with given granule
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function applyWorkflow(params) {
  deprecate('@cumulus/integration-tests/granulesApi.applyWorkflow', '1.20.0', '@cumulus/cumulus-api-client/granules.applyWorkflow');
  return granulesApi.applyWorkflow(params);
}

/**
 * Delete a granule from Cumulus via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the delete confirmation from the API
 */
async function deleteGranule(params) {
  deprecate('@cumulus/integration-tests/granulesApi.deleteGranule', '1.20.0', '@cumulus/cumulus-api-client/granules.deleteGranule');
  return granulesApi.deleteGranule(params);
}

/**
 * Move a granule via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @param {Array<Object>} params.destinations - move granule destinations
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the move response from the API
 */
async function moveGranule(params) {
  deprecate('@cumulus/integration-tests/granulesApi.moveGranule', '1.20.0', '@cumulus/cumulus-api-client/granules.moveGranule');
  return granulesApi.moveGranule(params);
}

/**
 * Removed a granule from CMR and delete from Cumulus via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the delete confirmation from the API
 */
async function removePublishedGranule(params) {
  deprecate('@cumulus/integration-tests/granulesApi.removePublishedGranule', '1.20.0', '@cumulus/cumulus-api-client/granules.removePublishedGranule');
  return granulesApi.removePublishedGranule(params);
}


async function listGranules(params) {
  deprecate('@cumulus/integration-tests/granulesApi.listGranules', '1.20.0', '@cumulus/cumulus-api-client/granules.listGranules');
  return granulesApi.listGranules(params);
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
