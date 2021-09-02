'use strict';

const indexer = require('@cumulus/es-client/indexer');
const models = require('../models');
const { getESClientAndIndex } = require('./local-test-defaults');
const {
  erasePostgresTables,
} = require('./serve');
const {
  GranulesExecutionsPgModel,
  RulePgModel,
  GranulePgModel,
  PdrPgModel,
  ExecutionPgModel,
  CollectionPgModel,
  ProviderPgModel,
  PostgresGranuleExecution,
  translateApiCollectionToPostgresCollection,
  translateApiProviderToPostgresProvider,
  translateApiExecutionToPostgresExecution,
  translateApiGranuleToPostgresGranule,
  translateApiPdrToPostgresPdr,
  translateApiRuleToPostgresRule,
  getKnexClient,
  localStackConnectionEnv,
  envParams,
  createTestDatabase
} = require('@cumulus/db');
const { log } = require('console');

const migrationDir = 'node_modules/@cumulus/db/dist/migrations';

async function resetPostgresDb() {
  const knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
      migrationDir,
    },
  });

  try{
    await createTestDatabase(knexAdmin, 'postgres', localStackConnectionEnv.PG_USER);
  } catch(error) {
    log(`Skipping Postgres DB creation because ${error}`);
  }

  await knex.migrate.latest();

  await erasePostgresTables(knex);

  return;
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
  return await Promise.all(
    collections.map(async (c) => {
      const dynamoRecord = await collectionModel.create(c);
      await indexer.indexCollection(es.client, dynamoRecord, es.index);
      const dbRecord = await translateApiCollectionToPostgresCollection(c);
      const collectionPgModel = new CollectionPgModel();
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
  return await Promise.all(
    granules.map(async (g) => {
      const dynamoRecord = await granuleModel.create(g);
      await indexer.indexGranule(es.client, dynamoRecord, es.index);
      const dbRecord = await translateApiGranuleToPostgresGranule(dynamoRecord, knex);
      const granulePgModel = new GranulePgModel();
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
  return await Promise.all(
    providers.map(async (p) => {
      const dynamoRecord = await providerModel.create(p);
      await indexer.indexProvider(es.client, dynamoRecord, es.index);
      const dbRecord = await translateApiProviderToPostgresProvider(dynamoRecord);
      const providerPgModel = new ProviderPgModel();
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
  return await Promise.all(
    rules.map(async (r) => {
      const dynamoRecord = await ruleModel.create(r);
      await indexer.indexRule(es.client, dynamoRecord, es.index);
      const dbRecord = await translateApiRuleToPostgresRule(dynamoRecord, knex);
      const rulePgModel = new RulePgModel();
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
  const starterPromise = Promise.resolve(null);
  return await executions.reduce((p, e) => p
    .then(async () => await executionModel.create(e))
    .then((dynamoRecord) => {
      translateApiExecutionToPostgresExecution(dynamoRecord, knex)
        .then(async (dbRecord) => {
          const executionPgModel = new ExecutionPgModel();
          await executionPgModel.create(knex, dbRecord);
        });
      indexer.indexExecution(es.client, dynamoRecord, es.index);
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
  return await Promise.all(
    pdrs.map(async (p) => {
      const dynamoRecord = await pdrModel.create(p);
      await indexer.indexPdr(es.client, dynamoRecord, es.index);
      const dbRecord = await translateApiPdrToPostgresPdr(dynamoRecord, knex);
      const pdrPgModel = new PdrPgModel();
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

  return await Promise.all(
    granulesExecutions.map(async (ge) => {

      // Fetch the Collection ID
      let collectionCumulusId;
      try{
        const [ name, version ] = ge.granule.collectionId.split('___');
        const collectionPgModel = new CollectionPgModel();
        collectionCumulusId = await collectionPgModel.getRecordCumulusId(knex, {
          name: name,
          version: version
        });
      } catch(error) {
          throw error;
      }

      // Fetch the Granule ID
      let granuleCumulusId;
      try{
        const granulePgModel = new GranulePgModel();
        granuleCumulusId = await granulePgModel.getRecordCumulusId(knex, {
          granule_id: ge.granule.granuleId,
          collection_cumulus_id: collectionCumulusId
        });
      } catch(error) {
          throw error;
      }

      // Fetch the Execution ID
      let executionCumulusId;
      try{
        const executionPgModel = new ExecutionPgModel();
        executionCumulusId = await executionPgModel.getRecordCumulusId(knex, {
          arn: ge.execution.arn
        });
      } catch(error) {
          console.log('ANTHONY: ' + ge.execution.arn);
          throw error;
      }

      // Create and insert the GranuleExecution record into the DB
      const granulesExecutionsPgModel = new GranulesExecutionsPgModel();
      const dbRecord = {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId
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
