'use strict';

/**
 * @module Collections
 *
 * @example
 *
 * const Collections = require('@cumulus/integration-test/Collections');
 */

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
 * Create a collection using the Cumulus API.
 *
 * The default collection is very simple. It expects that, for any discovered file, the granule ID
 * is everything in the filename before the extension. For example, a file named `gran-1.txt` would
 * have a granuleId of `gran-1`. Filenames can only contain a single `.` character.
 *
 * **Collection defaults**
 *
 * - **name**: random string starting with `collection-name-`
 * - **version**: random string starting with `collection-version-`
 * - **reportToEms**: `false`
 * - **granuleId**: `'^[^.]+$'`
 * - **granuleIdExtraction**: `'^([^.]+)\..+$'`
 * - **sampleFileName**: `'asdf.jpg'`
 * - **files**:
 *   ```js
 *   [
 *     {
 *       bucket: 'protected',
 *       regex: '^[^.]+\..+$',
 *       sampleFileName: 'asdf.jpg'
 *     }
 *   ]
 *   ```
 *
 * @param {string} prefix - the Cumulus stack name
 * @param {Object} [overrides={}] - properties to set on the collection, overriding the defaults
 * @returns {Promise<Object>} the generated collection
 *
 * @alias module:Collections
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
