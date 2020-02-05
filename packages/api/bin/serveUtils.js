'use strict';

const indexer = require('../es/indexer');
const models = require('../models');
const { getESClientAndIndex } = require('./local-test-defaults');

async function addCollections(collections) {
  const collectionModel = new models.Collection();
  const es = await getESClientAndIndex();
  return Promise.all(
    collections.map((c) =>
      collectionModel
        .create(c)
        .then((collection) =>
          indexer.indexCollection(es.client, collection, es.index)))
  );
}

async function addGranules(granules) {
  const granuleModel = new models.Granule();
  const es = await getESClientAndIndex();
  return Promise.all(
    granules.map((c) =>
      granuleModel
        .create(c)
        .then((granule) => indexer.indexGranule(es.client, granule, es.index)))
  );
}

async function addProviders(providers) {
  const providerModel = new models.Provider();
  const es = await getESClientAndIndex();
  return Promise.all(
    providers.map((p) =>
      providerModel
        .create(p)
        .then((provider) => indexer.indexProvider(es.client, provider, es.index)))
  );
}

async function addRules(rules) {
  const ruleModel = new models.Rule();
  const es = await getESClientAndIndex();
  return Promise.all(
    rules.map((r) =>
      ruleModel
        .create(r)
        .then((rule) => indexer.indexRule(es.client, rule, es.index)))
  );
}

async function addExecutions(executions) {
  const executionModel = new models.Execution();
  const es = await getESClientAndIndex();
  return Promise.all(
    executions.map((e) =>
      executionModel
        .create(e)
        .then((execution) =>
          indexer.indexExecution(es.client, execution, es.index)))
  );
}

async function addPdrs(pdrs) {
  const pdrModel = new models.Pdr();
  const es = await getESClientAndIndex();
  return Promise.all(
    pdrs.map((p) =>
      pdrModel.create(p).then((pdr) => indexer.indexPdr(es.client, pdr, es.index)))
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
