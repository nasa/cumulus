'use strict';

const { callCumulusApi } = require('./api');

/**
 * Post a request to the ems API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Object} params.request - request body to post
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
async function createEmsReports({ prefix, request }) {
  return callCumulusApi({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json'
      },
      path: '/ems',
      body: JSON.stringify(request)
    }
  });
}

module.exports = { createEmsReports };
