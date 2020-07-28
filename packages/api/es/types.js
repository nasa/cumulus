'use strict';

const get = require('lodash/get');

const fullMappings = require('../models/mappings.json');

const asyncOperationMappings = require('./mappings/asyncOperation.json');
const collectionMappings = require('./mappings/collection.json');
const deletedGranuleMappings = require('./mappings/deletedGranule.json');
const executionMappings = require('./mappings/execution.json');
const granuleMappings = require('./mappings/granule.json');
const logMappings = require('./mappings/logs.json');
const pdrMappings = require('./mappings/pdr.json');
const providerMappings = require('./mappings/provider.json');
const reconciliationReportMappings = require('./mappings/reconciliationReport.json');
const ruleMappings = require('./mappings/rule.json');

const typeMappings = [];
typeMappings.asyncOperation = asyncOperationMappings;
typeMappings.collection = collectionMappings;
typeMappings.deletedgranule = deletedGranuleMappings;
typeMappings.execution = executionMappings;
typeMappings.granule = granuleMappings;
typeMappings.logs = logMappings;
typeMappings.pdr = pdrMappings;
typeMappings.provider = providerMappings;
typeMappings.reconciliationReport = reconciliationReportMappings;
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
        return `${aliasOverride}-${type.toLowerCase()}`;
      }

      return `cumulus-${type.toLowerCase()}-alias`;
    // LAUREN TO DO - throw error
    }
  }

  return aliasOverride || defaultIndexAlias;
}

function getIndexNameForType(type, indexName) {
  if (process.env.MULTI_INDICES) {
    if (indexName) {
      return `${indexName}-${type.toLowerCase()}`;
    }

    return `cumulus-${type.toLowerCase()}-index`;
  }

  return indexName || `cumulus-${type.toLowerCase()}-index`;
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
