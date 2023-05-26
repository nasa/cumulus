'use strict';

const { deprecate } = require('@cumulus/common/util');
const granulesApi = require('@cumulus/api-client/granules');

/**
 * GET /granules/{granuleId}
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function getGranule(params) {
  deprecate('@cumulus/integration-tests/granules.getGranule', '1.21.0', '@cumulus/api-client/granules.getGranule');
  return await granulesApi.getGranule(params);
}

async function waitForGranule(params) {
  deprecate('@cumulus/integration-tests/granules.waitForGranule', '1.21.0', '@cumulus/api-client/granules.waitForGranule');
  return await granulesApi.waitForGranule(params);
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
  deprecate('@cumulus/integration-tests/granules.reingestGranule', '1.21.0', '@cumulus/api-client/granules.reingestGranule');
  return await granulesApi.reingestGranule(params);
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
  deprecate('@cumulus/integration-tests/granules.removeFromCMR', '1.21.0', '@cumulus/api-client/granules.removeFromCMR');
  return await granulesApi.removeFromCMR(params);
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
  deprecate('@cumulus/integration-tests/granules.applyWorkflow', '1.21.0', '@cumulus/api-client/granules.applyWorkflow');
  return await granulesApi.applyWorkflow(params);
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
  deprecate('@cumulus/integration-tests/granules.deleteGranule', '1.21.0', '@cumulus/api-client/granules.deleteGranule');
  return await granulesApi.deleteGranule(params);
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
  deprecate('@cumulus/integration-tests/granules.moveGranule', '1.21.0', '@cumulus/api-client/granules.moveGranule');
  return await granulesApi.moveGranule(params);
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
  deprecate('@cumulus/integration-tests/granules.removePublishedGranule', '1.21.0', '@cumulus/api-client/granules.removePublishedGranule');
  return await granulesApi.removePublishedGranule(params);
}

async function listGranules(params) {
  deprecate('@cumulus/integration-tests/granules.listGranules', '1.21.0', '@cumulus/api-client/granules.listGranules');
  return await granulesApi.listGranules(params);
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
  removePublishedGranule,
};
