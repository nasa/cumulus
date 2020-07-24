'use strict';

const get = require('lodash/get');

const fullMappings = require('../models/mappings.json');

const collectionMappings = require('./mappings/collection.json');
const ruleMappings = require('./mappings/rule.json');

const typeMappings = [];
typeMappings.collection = collectionMappings;
typeMappings.rule = ruleMappings;

const defaultIndexAlias = 'cumulus-alias';

function getEsTypes() {
  if (process.env.MULTI_INDICES) {
    return Object.keys(typeMappings);
  }

  return ['all'];
}

function isValidEsType(type) {
  return getEsTypes().includes(type);
}

function getAliasByType(type, aliasOverride = undefined) {
  if (process.env.MULTI_INDICES) {
    if (isValidEsType(type)) {
      if (aliasOverride) {
        return `${aliasOverride}-${type}`;
      }

      return `cumulus-${type}-alias`;
    // LAUREN TO DO - throw error
    }
  }

  return aliasOverride || defaultIndexAlias;
}

function getIndexNameForType(type, indexName) {
  if (process.env.MULTI_INDICES) {
    if (indexName) {
      return `${indexName}-${type}`;
    }

    return `cumulus-${type}-index`;
  }

  return indexName || `cumulus-${type}-index`;
}

function getMappingsByType(type) {
  if (process.env.MULTI_INDICES) {
    return get(typeMappings, type, fullMappings);
  }

  return fullMappings;
}

module.exports = {
  getAliasByType,
  getEsTypes,
  getIndexNameForType,
  getMappingsByType
};
