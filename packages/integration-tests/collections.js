'use strict';

const CollectionsApi = require('@cumulus/api-client/collections');
const { randomId } = require('@cumulus/common/test-utils');

const buildCollection = (overrides = {}) => ({
  name: randomId('collection-name-'),
  version: randomId('collection-version-'),
  reportToEms: false,
  granuleId: '^[^.]+$',
  granuleIdExtraction: '^([^.]+)\..+$',
  sampleFileName: 'asdf.jpg',
  files: [
    {
      bucket: 'protected',
      regex: '^[^.]+\..+$',
      sampleFileName: 'asdf.jpg'
    }
  ],
  ...overrides
});

/**
 * Build a collection and create it using the Cumulus API
 *
 * See the `@cumulus/integration-tests` README for more information
 *
 * @param {string} prefix - the Cumulus stack name
 * @param {Object} overrides - properties to set on the collection, overriding
 *   the defaults
 * @returns {Promise<Object>} the generated collection
 */
const createCollection = async (prefix, overrides = {}) => {
  const collection = buildCollection(overrides);

  const createResponse = await CollectionsApi.createCollection({
    prefix,
    collection
  });

  if (createResponse.statusCode !== 200) {
    throw new Error(`Failed to create collection: ${JSON.stringify(createResponse)}`);
  }

  return collection;
};

module.exports = {
  createCollection
};
