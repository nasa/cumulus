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
const { createRuleTrigger } = require('../lib/rulesHelpers');
const { fakeGranuleFactoryV2 } = require('../lib/testUtils');
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

  const es = await getESClientAndIndex();
  const collectionPgModel = new CollectionPgModel();
  return await Promise.all(
    collections.map(async (c) => {
      await indexer.indexCollection(es.client, c, es.index);
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

  const executionPgModel = new ExecutionPgModel();
  const es = await getESClientAndIndex();
  return await Promise.all(
    granules.map(async (apiGranule) => {
      const newGranule = fakeGranuleFactoryV2(
        {
          ...apiGranule,
        }
      );
      await indexer.indexGranule(es.client, newGranule, es.index);
      const dbRecord = await translateApiGranuleToPostgresGranule({
        newGranule,
        knexOrTransaction: knex,
      });
      const executionCumulusId = await executionPgModel.getRecordCumulusId(knex, {
        url: newGranule.execution,
      });

      await upsertGranuleWithExecutionJoinRecord({
        knexTransaction: knex,
        dbRecord,
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

  const es = await getESClientAndIndex();
  const providerPgModel = new ProviderPgModel();
  return await Promise.all(
    providers.map(async (provider) => {
      await indexer.indexProvider(es.client, provider, es.index);
      const dbRecord = await translateApiProviderToPostgresProvider(provider);
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

  const es = await getESClientAndIndex();
  const rulePgModel = new RulePgModel();
  return await Promise.all(
    rules.map(async (r) => {
      const ruleRecord = await createRuleTrigger(r);
      await indexer.indexRule(es.client, ruleRecord, es.index);
      const dbRecord = await translateApiRuleToPostgresRule(ruleRecord, knex);
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

  const es = await getESClientAndIndex();
  const pdrPgModel = new PdrPgModel();
  return await Promise.all(
    pdrs.map(async (p) => {
      await indexer.indexPdr(es.client, p, es.index);
      const dbRecord = await translateApiPdrToPostgresPdr(p, knex);
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
