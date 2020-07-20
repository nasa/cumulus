'use strict';

const get = require('lodash/get');

const fullMappings = require('../models/mappings.json');

const collectionMappings = require('./mappings/collection.json');
const ruleMappings = require('./mappings/rule.json');

const typeAliases = [];
typeAliases.collection = 'cumulus-collection-alias';
typeAliases.rule = 'cumulus-rule-alias';

const typeMappings = [];
typeMappings.collection = collectionMappings;
typeMappings.rule = ruleMappings;

const defaultIndexAlias = 'cumulus-alias';

function getAliasByType(type) {
  if (process.env.MULTI_INDICES) {
    return get(typeAliases, type, defaultIndexAlias);
  }

  return defaultIndexAlias;
}

function getMappingsByType(type) {
  if (process.env.MULTI_INDICES) {
    return get(typeMappings, type, fullMappings);
  }

  return fullMappings;
}

module.exports = [
  getAliasByType,
  getMappingsByType
];
