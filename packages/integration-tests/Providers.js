'use strict';

/**
 * @module Providers
 *
 * @example
 * const Providers = require('@cumulus/integration-test/Providers');
 */

const providersApi = require('@cumulus/api-client/providers');
const { randomId } = require('@cumulus/common/test-utils');

const buildProvider = (overrides = {}) => ({
  id: randomId('provider-'),
  globalConnectionLimit: 10,
  protocol: 's3',
  ...overrides,
});

/**
 * Create a provider using the Cumulus API
 *
 * **Provider defaults:**
 *
 * - **id**: random string starting with `provider-`
 * - **protocol**: `s3`
 * - **globalConnectionLimit**: `10`
 *
 * @param {string} prefix - the Cumulus stack name
 * @param {Object} [overrides] - properties to set on the provider, overriding the defaults
 * @returns {Promise<Object>} the generated provider
 *
 * @alias module:Providers
 */
const createProvider = async (prefix, overrides = {}) => {
  const provider = buildProvider(overrides);

  const createResponse = await providersApi.createProvider({
    prefix, provider,
  });

  if (createResponse.statusCode !== 200) {
    throw new Error(`Failed to create provider: ${JSON.stringify(createResponse)}`);
  }

  return provider;
};

module.exports = {
  createProvider,
};
