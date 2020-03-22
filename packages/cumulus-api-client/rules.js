'use strict';

const Logger = require('@cumulus/logger');
const { invokeApi } = require('./cumulusApiClient');
const logger = new Logger({ sender: '@api-client/rules' });


/**
 * Call function in rules API with payload
 *
 * @param {string} prefix               - the prefix configured for the stack
 * @param {Object} requestPayload       - payload to be sent to the API lambda
 *                                        containing the httpMethod, path,  b
 *                                        path params, and body
 * @param {Function} callback           - async function to invoke the api lambda
 *                                        that takes a prefix / user payload.  Defaults
 *                                        to cumulusApiClient.invokeApi
 * @returns {Object}                    - response from API lambda
 * @throws error if response cannot be parsed
 */
// Todo make this a module-wide thing
async function callRuleApiFunction(prefix, requestPayload, callback = invokeApi) {
  let payload;
  try {
    payload = await callback({
      prefix,
      payload: requestPayload
    });
    return payload;
  } catch (error) {
    logger.error(`Error parsing JSON response for rule ${requestPayload.httpMethod}: ${requestPayload}`);
    throw error;
  }
}

/**
 * Post a rule to the rules API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.rule         - rule body to post
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the API lambda
 */
async function postRule({ prefix, rule, callback = invokeApi }) {
  const payload = {
    httpMethod: 'POST',
    resource: '/{proxy+}',
    headers: {
      'Content-Type': 'application/json'
    },
    path: '/rules',
    body: JSON.stringify(rule)
  };

  return callRuleApiFunction(prefix, payload, callback);
}

/**
 * Update a rule in the rules API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.ruleName     - the rule to update
 * @param {Object} params.updateParams - key/value to update on the rule
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output of the API lambda
 */
async function updateRule({
  prefix, ruleName, updateParams, callback = invokeApi
}) {
  const payload = {
    httpMethod: 'PUT',
    resource: '/{proxy+}',
    headers: {
      'Content-Type': 'application/json'
    },
    path: `/rules/${ruleName}`,
    body: JSON.stringify(updateParams)
  };

  return callRuleApiFunction(prefix, payload, callback);
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
async function listRules({ prefix, query = {}, callback = invokeApi }) {
  const payload = {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: '/rules',
    queryStringParameters: query
  };

  return callRuleApiFunction(prefix, payload, callback);
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
async function getRule({ prefix, ruleName, callback = invokeApi }) {
  const payload = {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: `/rules/${ruleName}`
  };

  return callRuleApiFunction(prefix, payload, callback);
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
async function deleteRule({ prefix, ruleName, callback = invokeApi }) {
  const payload = {
    httpMethod: 'DELETE',
    resource: '/{proxy+}',
    path: `/rules/${ruleName}`
  };

  return callRuleApiFunction(prefix, payload, callback);
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
async function rerunRule({
  prefix, ruleName, updateParams = {}, callback = invokeApi
}) {
  return updateRule({
    prefix,
    ruleName,
    updateParams: {
      ...updateParams,
      action: 'rerun'
    },
    callback
  });
}

module.exports = {
  postRule,
  updateRule,
  deleteRule,
  getRule,
  listRules,
  rerunRule
};
