'use strict';

const indexer = require('../es/indexer');
const models = require('../models');

async function addCollections(collections, esClient, esIndex) {
  const collectionModel = new models.Collection();
  return Promise.all(
    collections.map((c) =>
      collectionModel
        .create(c)
        .then((collection) =>
          indexer.indexCollection(esClient, collection, esIndex)))
  );
}

async function addGranules(granules, esClient, esIndex) {
  const granuleModel = new models.Granule();
  return Promise.all(
    granules.map((c) =>
      granuleModel
        .create(c)
        .then((granule) => indexer.indexGranule(esClient, granule, esIndex)))
  );
}

async function addProviders(providers, esClient, esIndex) {
  const providerModel = new models.Provider();
  return Promise.all(
    providers.map((p) =>
      providerModel
        .create(p)
        .then((provider) => indexer.indexProvider(esClient, provider, esIndex)))
  );
}

async function addRules(rules, esClient, esIndex) {
  const ruleModel = new models.Rule();
  return Promise.all(
    rules.map((r) =>
      ruleModel
        .create(r)
        .then((rule) => indexer.indexRule(esClient, rule, esIndex)))
  );
}

async function addExecutions(executions, esClient, esIndex) {
  const executionModel = new models.Execution();
  return Promise.all(
    executions.map((e) =>
      executionModel
        .create(e)
        .then((execution) =>
          indexer.indexExecution(esClient, execution, esIndex)))
  );
}

async function addPdrs(pdrs, esClient, esIndex) {
  const pdrModel = new models.Pdr();
  return Promise.all(
    pdrs.map((p) =>
      pdrModel.create(p).then((pdr) => indexer.indexPdr(esClient, pdr, esIndex)))
  );
}

module.exports = {
  addCollections,
  addExecutions,
  addGranules,
  addPdrs,
  addProviders,
  addRules
};
