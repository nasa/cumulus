'use strict';

const get = require('lodash/get');

const fullMappings = require('../models/mappings.json');

// const collectionMappings = require('./mappings/collection.json');
const ruleMappings = require('./mappings/rule.json');

const typeMappings = [];
// typeMappings.collection = collectionMappings;
typeMappings.rule = ruleMappings;

const defaultIndexAlias = 'cumulus-alias';

function getEsTypes() {
  return Object.keys(typeMappings);
}

function isValidEsType(type) {
  return getEsTypes().includes(type);
}

function getAliasByType(type, aliasOverride = undefined) {
  if (process.env.MULTI_INDICES) {
    if (isValidEsType(type)) {
      if (aliasOverride) {
        return `${aliasOverride}-type`;
      }

      return `cumulus-${type}-alias`;
    }

    // LAUREN TO DO - throw error
  }

  return aliasOverride || defaultIndexAlias;
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
  getMappingsByType
};
