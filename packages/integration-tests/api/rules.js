'use strict';

const { callCumulusApi } = require('./api');

/**
 * Call function in rules API with payload
 *
 * @param {string} prefix - the prefix configured for the stack
 * @param {Object} requestPayload - payload to be sent to the API lambda
 * containing the httpMethod, path, path params, and body
 * @returns {Object} - response from API lambda
 * @throws error if response cannot be parsed
 */
async function callRuleApiFunction(prefix, requestPayload) {
  const payload = await callCumulusApi({
    prefix,
    functionName: 'ApiRulesDefault',
    payload: requestPayload
  });

  console.log(`payload: ${payload}`);

  try {
    return payload;
  }
  catch (error) {
    console.log(`Error parsing JSON response for rule ${payload.httpMethod}: ${payload}`);
    throw error;
  }
}

/**
 * Post a rule to the rules API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Object} params.rule - rule body to post
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
async function postRule({ prefix, rule }) {
  const payload = {
    httpMethod: 'POST',
    resource: '/rules',
    path: 'rules',
    body: JSON.stringify(rule)
  };

  return callRuleApiFunction(prefix, payload);
}

/**
 * Update a rule in the rules API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Object} params.rule - the rule to update
 * @param {Object} params.updateParams - key/value to update on the rule
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
async function updateRule({ prefix, rule, updateParams }) {
  const payload = {
    httpMethod: 'PUT',
    resource: '/rules/{name}',
    path: `rules/${rule.name}`,
    pathParameters: {
      name: rule.name
    },
    body: JSON.stringify(Object.assign(rule, updateParams)),
  };

  return callRuleApiFunction(prefix, payload);
}

/**
 * Get a list of rules from the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
async function listRules({ prefix }) {
  const payload = {
    httpMethod: 'GET',
    resource: '/rules',
    path: 'rules'
  };

  return callRuleApiFunction(prefix, payload);
}

/**
 * Delete a rule via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
async function deleteRule({ prefix, ruleName }) {
  const payload = {
    httpMethod: 'DELETE',
    resource: '/rules/{name}',
    path: `rules/${ruleName}`,
    pathParameters: { name: ruleName }
  };

  return callRuleApiFunction(prefix, payload);
}

module.exports = {
  postRule,
  updateRule,
  deleteRule,
  listRules
};
