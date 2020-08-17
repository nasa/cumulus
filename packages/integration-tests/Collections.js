'use strict';

/**
 * @module Collections
 *
 * @example
 *
 * const Collections = require('@cumulus/integration-test/Collections');
 */

const isString = require('lodash/isString');

const CollectionsApi = require('@cumulus/api-client/collections');
const { randomId } = require('@cumulus/common/test-utils');
const { readJsonFilesFromDir, setProcessEnvironment } = require('./utils');

/**
 * Given a Cumulus collection configuration, return a list of the filetype
 * configs with their `url_path`s updated.
 *
 * @param {Object} collection - a Cumulus collection
 * @param {string} customFilePath - path to be added to the end of the url_path
 * @returns {Array<Object>} a list of collection filetype configs
 */
const addCustomUrlPathToCollectionFiles = (collection, customFilePath) =>
  collection.files.map((file) => {
    let urlPath;
    if (isString(file.url_path)) {
      urlPath = `${file.url_path}/`;
    } else if (isString(collection.url_path)) {
      urlPath = `${collection.url_path}/`;
    } else {
      urlPath = '';
    }

    return {
      ...file,
      url_path: `${urlPath}${customFilePath}/`,
    };
  });

/**
 * Update a collection with a custom file path, duplicate handling, and name
 * updated with the postfix.
 *
 * @param {Object} params
 * @param {Object} params.collection - a collection configuration
 * @param {string} params.customFilePath - path to be added to the end of the
 *   url_path
 * @param {string} params.duplicateHandling - duplicate handling setting
 * @param {string} params.postfix - a string to be appended to the end of the
 *   name
 * @returns {Object} an updated collection
 */
const buildCollection = (params = {}) => {
  const {
    collection, customFilePath, duplicateHandling, postfix,
  } = params;

  const updatedCollection = { ...collection };

  if (postfix) {
    updatedCollection.name += postfix;
  }

  if (customFilePath) {
    updatedCollection.files = addCustomUrlPathToCollectionFiles(
      collection,
      customFilePath
    );
  }

  if (duplicateHandling) {
    updatedCollection.duplicateHandling = duplicateHandling;
  }

  return updatedCollection;
};

const buildRandomizedCollection = (overrides = {}) => ({
  name: randomId('collection-name-'),
  version: randomId('collection-version-'),
  reportToEms: false,
  granuleId: '^[^.]+$',
  granuleIdExtraction: '^([^.]+)\..+$',
  sampleFileName: 'asdf.jpg',
  url_path: randomId('url-path-'),
  files: [
    {
      bucket: 'protected',
      regex: '^[^.]+\..+$',
      sampleFileName: 'asdf.jpg',
    },
  ],
  ...overrides,
});

/**
 * Add a new collection to Cumulus
 *
 * @param {string} stackName - the prefix of the Cumulus stack
 * @param {Object} collection - a Cumulus collection
 * @returns {Promise<undefined>}
 */
const addCollection = async (stackName, collection) => {
  await CollectionsApi.deleteCollection({
    prefix: stackName,
    collectionName: collection.name,
    collectionVersion: collection.version,
  });
  await CollectionsApi.createCollection({ prefix: stackName, collection });
};

/**
 * Add collections to database
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} dataDirectory - the directory of collection json files
 * @param {string} [postfix] - string to append to collection name
 * @param {string} [customFilePath]
 * @param {string} [duplicateHandling]
 * @returns {Promise<Object[]>} - collections that were added
 */
async function addCollections(stackName, bucketName, dataDirectory, postfix,
  customFilePath, duplicateHandling) {
  // setProcessEnvironment is not needed by this function, but other code
  // depends on this undocumented side effect
  setProcessEnvironment(stackName, bucketName);

  const rawCollections = await readJsonFilesFromDir(dataDirectory);
  const collections = rawCollections.map(
    (collection) => buildCollection({
      collection,
      customFilePath,
      duplicateHandling,
      postfix,
    })
  );

  await Promise.all(
    collections.map((collection) => addCollection(stackName, collection))
  );
  return collections;
}

/**
 * Create a randomized collection using the Cumulus API.
 *
 * The default collection is very simple. It expects that, for any discovered file, the granule ID
 * is everything in the filename before the extension. For example, a file named `gran-1.txt` would
 * have a granuleId of `gran-1`. Filenames can only contain a single `.` character.
 *
 * **Collection defaults:**
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
 * @param {Object} [overrides] - properties to set on the collection, overriding the defaults
 * @returns {Promise<Object>} the generated collection
 *
 * @alias module:Collections
 */
const createCollection = async (prefix, overrides = {}) => {
  const collection = buildRandomizedCollection(overrides);

  const createResponse = await CollectionsApi.createCollection({
    prefix,
    collection,
  });

  if (createResponse.statusCode !== 200) {
    throw new Error(`Failed to create collection: ${JSON.stringify(createResponse)}`);
  }

  return collection;
};

module.exports = {
  addCollections,
  buildCollection,
  createCollection,
};
