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
  deprecate('@cumulus/integration-tests/rulesApi.getExecution', '1.20.0', '@cumulus/cumulus-api-client/rules.getExecution');
  return rulesApi.postRule(params);
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
  deprecate('@cumulus/integration-tests/rulesApi.updateRule', '1.20.0', '@cumulus/cumulus-api-client/rules.updateRule');
  return rulesApi.updateRule(params);
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
  deprecate('@cumulus/integration-tests/rulesApi.listRules', '1.20.0', '@cumulus/cumulus-api-client/rules.listRules');
  return rulesApi.listRules(params);
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
  deprecate('@cumulus/integration-tests/rulesApi.getRule', '1.20.0', '@cumulus/cumulus-api-client/rules.getRule');
  return rulesApi.getRule(params);
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
  deprecate('@cumulus/integration-tests/rulesApi.deleteRule', '1.20.0', '@cumulus/cumulus-api-client/rules.deleteRule');
  return rulesApi.deleteRule(params);
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
  deprecate('@cumulus/integration-tests/rulesApi.rerunRule', '1.20.0', '@cumulus/cumulus-api-client/rules.rerunRule');
  return rulesApi.rerunRule(params);
}

module.exports = {
  postRule,
  updateRule,
  deleteRule,
  getRule,
  listRules,
  rerunRule
};
