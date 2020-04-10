'use strict';

const CollectionsApi = require('@cumulus/api-client/collections');
const randomId = require('./randomId');

const buildCollection = (overrides = {}) => ({
  name: randomId('collection-name'),
  version: randomId('collection-version'),
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
