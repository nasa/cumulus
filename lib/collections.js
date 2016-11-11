'use strict';

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

// Parses collection JSON strings to handle inheritance and provider linkage
// Returns list of only concrete collections with inheritance chains and provider data resolved
exports.parseCollections = (collectionsStr, providersStr) => {
  const collections = JSON.parse(collectionsStr);
  const providers = JSON.parse(providersStr);
  const result = [];
  const collectionsById = indexBy(collections, 'id');

  for (const source of collections) {
    if (!source.abstract) {
      const chain = [source];
      let ancestor = source;
      while (ancestor.parent) {
        ancestor = collectionsById[ancestor.parent];
        chain.unshift(ancestor);
      }
      const collection = {};
      for (const obj of chain) {
        for (const prop of Object.keys(obj)) {
          if (prop !== 'abstract') {
            if (typeof obj[prop] === 'object' && collection[prop]) {
              collection[prop] = Object.assign({}, collection[prop], obj[prop]);
            }
            else {
              collection[prop] = obj[prop];
            }
          }
        }
      }
      const providerId = collection.providerId;
      if (typeof providerId === 'string') {
        collection.provider = Object.assign({ id: providerId }, providers[providerId]);
      }
      result.push(collection);
    }
  }
  return result;
};

// Similar to parseColections but groups collections by providers
exports.parseCollectionsByProvider = (collectionsStr, providersStr) =>
  groupBy(exports.parseCollections(collectionsStr, providersStr), 'providerId');

exports.parseCollectionsById = (collectionsStr, providersStr) =>
  indexBy(exports.parseCollections(collectionsStr, providersStr), 'id');
