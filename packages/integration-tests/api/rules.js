'use strict';

const { deprecate } = require('@cumulus/common/util');
const rulesApi = require('@cumulus/api-client/rules');

/**
 * Post a rule to the rules API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {Object} params.rule       - rule body to post
 * @param {Object} params.callback   - function to invoke the api lambda
 *                                     that takes a prefix / user payload
 * @returns {Promise<Object>}        - promise that resolves to the output
 *                                     of the API lambda
 */
async function postRule(params) {
  deprecate('@cumulus/integration-tests/rules.getExecution', '1.21.0', '@cumulus/api-client/rules.getExecution');
  return await rulesApi.postRule(params);
}

/**
 * Update a rule in the rules API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Object} params.ruleName - the rule to update
 * @param {Object} params.updateParams - key/value to update on the rule
 * @param {Object} params.callback - function to invoke the api lambda
 *                            that takes a prefix / user payload
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
async function updateRule(params) {
  deprecate('@cumulus/integration-tests/rules.updateRule', '1.21.0', '@cumulus/api-client/rules.updateRule');
  return await rulesApi.updateRule(params);
}

/**
 * Get a list of rules from the API
 *
 * @param {Object} params          - params
 * @param {string} params.prefix   - the prefix configured for the stack
 * @param {string} params.query    - query params to use for listing rules
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
async function listRules(params) {
  deprecate('@cumulus/integration-tests/rules.listRules', '1.21.0', '@cumulus/api-client/rules.listRules');
  return await rulesApi.listRules(params);
}

/**
 * Get a rule definition from the API
 *
 * @param {Object} params          - params
 * @param {string} params.prefix   - the prefix configured for the stack
 * @param {string} params.ruleName - name of the rule
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>}      - promise that resolves to the output of the
 *                                   API lambda
 */
async function getRule(params) {
  deprecate('@cumulus/integration-tests/rules.getRule', '1.21.0', '@cumulus/api-client/rules.getRule');
  return await rulesApi.getRule(params);
}

/**
 * Delete a rule via the API
 *
 * @param {Object} params          - params
 * @param {string} params.prefix   - the prefix configured for the stack
 * @param {string} params.ruleName - name of the rule
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
async function deleteRule(params) {
  deprecate('@cumulus/integration-tests/rules.deleteRule', '1.21.0', '@cumulus/api-client/rules.deleteRule');
  return await rulesApi.deleteRule(params);
}

/**
 * Rerun a rule via the API.
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.ruleName     - the name of the rule to rerun
 * @param {Object} params.updateParams - key/value to update on the rule
 * @param {Object} params.callback     - function to invoke the api lambda
 *                                       that takes a prefix / user payload
 * @returns {Promise<Object>} - promise that resolves to the output of the API
 *    lambda
 */
async function rerunRule(params) {
  deprecate('@cumulus/integration-tests/rules.rerunRule', '1.21.0', '@cumulus/api-client/rules.rerunRule');
  return await rulesApi.rerunRule(params);
}

module.exports = {
  postRule,
  updateRule,
  deleteRule,
  getRule,
  listRules,
  rerunRule,
};
