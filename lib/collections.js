'use strict';

const yaml = require('js-yaml');

const indexBy = (array, prop) => {
  const result = {};
  for (const item of array) {
    result[item[prop]] = item;
  }
  return result;
};

const groupBy = (array, prop) => {
  const result = {};
  for (const item of array) {
    const key = item[prop];
    result[key] = result[key] || [];
    result[key].push(item);
  }
  return result;
};

// Parses collections.yml string
// Returns a list of collections in the YAML document
exports.parseCollections = (collectionsStr) =>
  yaml.safeLoad(collectionsStr).collections;

// Similar to parseColections but groups collections by providers
exports.parseCollectionsByProvider = (collectionsStr) =>
  groupBy(exports.parseCollections(collectionsStr), 'providerId');

exports.parseCollectionsById = (collectionsStr) =>
  indexBy(exports.parseCollections(collectionsStr), 'id');
