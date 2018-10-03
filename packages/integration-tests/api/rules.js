'use strict';

const { callCumulusApi, getGranule } = require('./api');
const cloneDeep = require('lodash.clonedeep');
const {
  aws: { lambda }
} = require('@cumulus/common');
const {
  models: { User },
  testUtils: { fakeUserFactory }
} = require('@cumulus/api');

async function callRuleApiFunction(prefix, requestPayload) {
  const payload = await callCumulusApi({
    prefix,
    functionName: 'ApiRulesDefault',
    payload: requestPayload
  });

  console.log(`payload: ${payload}`);

  try {
    return JSON.parse(payload.body);
  }
  catch (error) {
    console.log(`Error parsing JSON response for rule ${payload.httpMethod}: ${payload}`);
    throw error;
  }
}

async function postRule({ prefix, rule }) {
  const payload = {
    httpMethod: 'POST',
    resource: '/rules',
    path: 'rules',
    body: JSON.stringify(rule)
  };

  return callRuleApiFunction(prefix, payload);
}

async function listRules({ prefix }) {
  const payload = {
    httpMethod: 'GET',
    resource: '/rules',
    path: 'rules'
  };

  return callRuleApiFunction(prefix, payload);
}

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
  deleteRule,
  listRules
};
