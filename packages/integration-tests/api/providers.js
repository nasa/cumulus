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

module.exports = {
  createProvider,
  deleteProvider
};
