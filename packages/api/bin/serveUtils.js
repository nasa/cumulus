'use strict';

const pEachSeries = require('p-each-series');
const indexer = require('@cumulus/es-client/indexer');
const {
  RulePgModel,
  PdrPgModel,
  ExecutionPgModel,
  CollectionPgModel,
  ProviderPgModel,
  translateApiCollectionToPostgresCollection,
  translateApiProviderToPostgresProvider,
  translateApiExecutionToPostgresExecution,
  translateApiGranuleToPostgresGranule,
  translateApiPdrToPostgresPdr,
  translateApiRuleToPostgresRule,
  upsertGranuleWithExecutionJoinRecord,
  getKnexClient,
  localStackConnectionEnv,
  envParams,
  createTestDatabase,
  migrationDir,
} = require('@cumulus/db');
const { log } = require('console');
const models = require('../models');
const { getESClientAndIndex } = require('./local-test-defaults');
const {
  erasePostgresTables,
} = require('./serve');

async function resetPostgresDb() {
  const knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
      migrationDir,
    },
  });

  try {
    await createTestDatabase(knexAdmin, 'postgres', localStackConnectionEnv.PG_USER);
  } catch (error) {
    log(`Skipping Postgres DB creation because ${error}`);
  }

  await knex.migrate.latest();

  await erasePostgresTables(knex);
}

async function addCollections(collections) {
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });

  const collectionModel = new models.Collection();
  const es = await getESClientAndIndex();
  const collectionPgModel = new CollectionPgModel();
  return await Promise.all(
    collections.map(async (c) => {
      const dynamoRecord = await collectionModel.create(c);
      await indexer.indexCollection(es.client, dynamoRecord, es.index);
      const dbRecord = await translateApiCollectionToPostgresCollection(c);
      await collectionPgModel.create(knex, dbRecord);
    })
  );
}

async function addGranules(granules) {
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });

  const granuleModel = new models.Granule();
  const executionPgModel = new ExecutionPgModel();
  const es = await getESClientAndIndex();
  return await Promise.all(
    granules.map(async (apiGranule) => {
      const dynamoRecord = await granuleModel.create(apiGranule);
      await indexer.indexGranule(es.client, dynamoRecord, es.index);
      const granule = await translateApiGranuleToPostgresGranule({
        dynamoRecord,
        knexOrTransaction: knex,
      });
      const executionCumulusId = await executionPgModel.getRecordCumulusId(knex, {
        url: apiGranule.execution,
      });

      await upsertGranuleWithExecutionJoinRecord({
        knexTransaction: knex,
        granule,
        executionCumulusId,
      });
    })
  );
}

async function addProviders(providers) {
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });

  const providerModel = new models.Provider();
  const es = await getESClientAndIndex();
  const providerPgModel = new ProviderPgModel();
  return await Promise.all(
    providers.map(async (p) => {
      const dynamoRecord = await providerModel.create(p);
      await indexer.indexProvider(es.client, dynamoRecord, es.index);
      const dbRecord = await translateApiProviderToPostgresProvider(dynamoRecord);
      await providerPgModel.create(knex, dbRecord);
    })
  );
}

async function addRules(rules) {
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });

  const ruleModel = new models.Rule();
  const es = await getESClientAndIndex();
  const rulePgModel = new RulePgModel();
  return await Promise.all(
    rules.map(async (r) => {
      const ruleWithTrigger = await ruleModel.createRuleTrigger(r);
      const dynamoRecord = await ruleModel.create(ruleWithTrigger);
      await indexer.indexRule(es.client, dynamoRecord, es.index);
      const dbRecord = await translateApiRuleToPostgresRule(dynamoRecord, knex);
      await rulePgModel.create(knex, dbRecord);
    })
  );
}

async function addExecutions(executions) {
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });

  const executionModel = new models.Execution();
  const es = await getESClientAndIndex();

  executions.sort((firstEl, secondEl) => {
    if (!firstEl.parentArn && !secondEl.parentArn) {
      return 0;
    }

    if ((!firstEl.parentArn && secondEl.parentArn) || firstEl.arn === secondEl.parentArn) {
      return -1;
    }

    return 1;
  });

  const executionPgModel = new ExecutionPgModel();
  const executionsIterator = async (execution) => {
    const dynamoRecord = await executionModel.create(execution);
    await indexer.indexExecution(es.client, dynamoRecord, es.index);
    const dbRecord = await translateApiExecutionToPostgresExecution(dynamoRecord, knex);
    await executionPgModel.create(knex, dbRecord);
  };

  await pEachSeries(executions, executionsIterator);
}

async function addPdrs(pdrs) {
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });

  const pdrModel = new models.Pdr();
  const es = await getESClientAndIndex();
  const pdrPgModel = new PdrPgModel();
  return await Promise.all(
    pdrs.map(async (p) => {
      const dynamoRecord = await pdrModel.create(p);
      await indexer.indexPdr(es.client, dynamoRecord, es.index);
      const dbRecord = await translateApiPdrToPostgresPdr(dynamoRecord, knex);
      await pdrPgModel.create(knex, dbRecord);
    })
  );
}

async function addReconciliationReports(reconciliationReports) {
  const reconciliationReportModel = new models.ReconciliationReport();
  const es = await getESClientAndIndex();
  return await Promise.all(
    reconciliationReports.map((r) =>
      reconciliationReportModel
        .create(r)
        .then((reconciliationReport) =>
          indexer.indexReconciliationReport(es.client, reconciliationReport, es.index)))
  );
}

module.exports = {
  resetPostgresDb,
  addProviders,
  addCollections,
  addExecutions,
  addGranules,
  addPdrs,
  addReconciliationReports,
  addRules,
};
