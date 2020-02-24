'use strict';

const { callCumulusApi } = require('./api');

const createProvider = (prefix, provider) =>
  callCumulusApi({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path: '/providers',
      body: JSON.stringify(provider)
    }
  });

const deleteProvider = (prefix, providerId) =>
  callCumulusApi({
    prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/providers/${providerId}`
    }
  });

/**
 * Fetch a provider from the Cumulus API
 *
 * @param {string} prefix - the prefix configured for the stack
 * @param {string} providerId - a provider id
 * @returns {Promise<Object>} - the provider fetched by the API
 */
const getProvider = (prefix, providerId) =>
  callCumulusApi({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/providers/${providerId}`
    }
  }).then(({ body }) => JSON.parse(body));

module.exports = {
  createProvider,
  deleteProvider,
  getProvider
};
