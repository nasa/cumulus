'use strict';

const indexer = require('@cumulus/es-client/indexer');
const {
  GranulesExecutionsPgModel,
  RulePgModel,
  GranulePgModel,
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
  const es = await getESClientAndIndex();
  const granulePgModel = new GranulePgModel();
  return await Promise.all(
    granules.map(async (g) => {
      const dynamoRecord = await granuleModel.create(g);
      await indexer.indexGranule(es.client, dynamoRecord, es.index);
      const dbRecord = await translateApiGranuleToPostgresGranule(dynamoRecord, knex);
      await granulePgModel.create(knex, dbRecord);
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
      const dynamoRecord = await ruleModel.create(r);
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

  // Since executions has a parent/child relationship with itself
  // a fake promise is used with reduce() to force records to be created
  // synchronously
  const executionPgModel = new ExecutionPgModel();
  const starterPromise = Promise.resolve(null);
  return await executions.reduce((p, e) => p
    .then(async () => await executionModel.create(e))
    .then((dynamoRecord) => {
      indexer.indexExecution(es.client, dynamoRecord, es.index);
      return translateApiExecutionToPostgresExecution(dynamoRecord, knex)
        .then(async (dbRecord) => {
          return await executionPgModel.create(knex, dbRecord);
        });
    }), starterPromise);
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

async function addGranulesExecutions(granulesExecutions) {
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });

  const collectionPgModel = new CollectionPgModel();
  return await Promise.all(
    granulesExecutions.map(async (ge) => {
      // Fetch the Collection ID
      const [name, version] = ge.granule.collectionId.split('___');
      const collectionCumulusId = await collectionPgModel.getRecordCumulusId(knex, {
        name: name,
        version: version,
      });

      // Fetch the Granule ID
      const granulePgModel = new GranulePgModel();
      const granuleCumulusId = await granulePgModel.getRecordCumulusId(knex, {
        granule_id: ge.granule.granuleId,
        collection_cumulus_id: collectionCumulusId,
      });

      // Fetch the Execution ID
      const executionPgModel = new ExecutionPgModel();
      const executionCumulusId = await executionPgModel.getRecordCumulusId(knex, {
        arn: ge.execution.arn,
      });

      // Create and insert the GranuleExecution record into the DB
      const granulesExecutionsPgModel = new GranulesExecutionsPgModel();
      const dbRecord = {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      };

      await granulesExecutionsPgModel.create(knex, dbRecord);
    })
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
  addGranulesExecutions,
};
