'use strict';

const { invokeApi } = require('./cumulusApiClient');

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
const createRule = async ({ prefix, rule, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'POST',
    resource: '/{proxy+}',
    headers: {
      'Content-Type': 'application/json'
    },
    path: '/rules',
    body: JSON.stringify(rule)
  }
});

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
const updateRule = async ({
  prefix, ruleName, updateParams, callback = invokeApi
}) => callback({
  prefix,
  payload: {
    httpMethod: 'PUT',
    resource: '/{proxy+}',
    headers: {
      'Content-Type': 'application/json'
    },
    path: `/rules/${ruleName}`,
    body: JSON.stringify(updateParams)
  }
});

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
const listRules = async ({ prefix, query = {}, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: '/rules',
    queryStringParameters: query
  }
});

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
const getRule = async ({ prefix, ruleName, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: `/rules/${ruleName}`
  }
});

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
const deleteRule = async ({ prefix, ruleName, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'DELETE',
    resource: '/{proxy+}',
    path: `/rules/${ruleName}`

  }
});


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
  createRule,
  updateRule,
  deleteRule,
  getRule,
  listRules,
  rerunRule
};
