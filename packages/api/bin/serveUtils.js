'use strict';

const pEachSeries = require('p-each-series');
const {
  AsyncOperationPgModel,
  CollectionPgModel,
  createTestDatabase,
  envParams,
  ExecutionPgModel,
  FilePgModel,
  getKnexClient,
  GranulePgModel,
  GranulesExecutionsPgModel,
  localStackConnectionEnv,
  migrationDir,
  PdrPgModel,
  ProviderPgModel,
  ReconciliationReportPgModel,
  RulePgModel,
  translateApiAsyncOperationToPostgresAsyncOperation,
  translateApiCollectionToPostgresCollection,
  translateApiExecutionToPostgresExecution,
  translateApiGranuleToPostgresGranule,
  translateApiFiletoPostgresFile,
  translateApiPdrToPostgresPdr,
  translateApiProviderToPostgresProvider,
  translateApiReconReportToPostgresReconReport,
  translateApiRuleToPostgresRule,
  upsertGranuleWithExecutionJoinRecord,
} = require('@cumulus/db');
const { log } = require('console');
const { createRuleTrigger } = require('../lib/rulesHelpers');
const { fakeGranuleFactoryV2 } = require('../lib/testUtils');

/**
* Remove all records from api-related postgres tables
* @param {Object} knex - knex/knex transaction object
* @returns {[Promise]} - Array of promises with deletion results
*/
async function erasePostgresTables(knex) {
  const asyncOperationPgModel = new AsyncOperationPgModel();
  const collectionPgModel = new CollectionPgModel();
  const executionPgModel = new ExecutionPgModel();
  const filePgModel = new FilePgModel();
  const granulePgModel = new GranulePgModel();
  const granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  const pdrPgModel = new PdrPgModel();
  const providerPgModel = new ProviderPgModel();
  const reconReportPgModel = new ReconciliationReportPgModel();
  const rulePgModel = new RulePgModel();

  await granulesExecutionsPgModel.delete(knex, {});
  await granulePgModel.delete(knex, {});
  await pdrPgModel.delete(knex, {});
  await executionPgModel.delete(knex, {});
  await asyncOperationPgModel.delete(knex, {});
  await filePgModel.delete(knex, {});
  await granulePgModel.delete(knex, {});
  await rulePgModel.delete(knex, {});
  await collectionPgModel.delete(knex, {});
  await providerPgModel.delete(knex, {});
  await reconReportPgModel.delete(knex, {});
}

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

async function addAsyncOperations(asyncOperations) {
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });
  const asyncOperationPgModel = new AsyncOperationPgModel();
  return await Promise.all(
    asyncOperations.map(async (r) => {
      const dbRecord = await translateApiAsyncOperationToPostgresAsyncOperation(r, knex);
      await asyncOperationPgModel.create(knex, dbRecord);
    })
  );
}

async function addCollections(collections) {
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });

  const collectionPgModel = new CollectionPgModel();
  return await Promise.all(
    collections.map(async (c) => {
      const dbRecord = await translateApiCollectionToPostgresCollection(c);
      await collectionPgModel.create(knex, dbRecord);
    })
  );
}

async function addGranules(granules, knexClient) {
  const knex = knexClient || await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });

  const executionPgModel = new ExecutionPgModel();
  const filePgModel = new FilePgModel();
  return await Promise.all(
    granules.map(async (apiGranule) => {
      const newGranule = fakeGranuleFactoryV2(
        {
          ...apiGranule,
        }
      );
      const dbRecord = await translateApiGranuleToPostgresGranule({
        dynamoRecord: newGranule,
        knexOrTransaction: knex,
      });
      const executionCumulusId = await executionPgModel.getRecordCumulusId(knex, {
        url: newGranule.execution,
      });

      const upsertedGranule = await upsertGranuleWithExecutionJoinRecord({
        knexTransaction: knex,
        granule: dbRecord,
        executionCumulusId,
      });

      if (newGranule.files.length > 0) {
        await filePgModel.insert(knex, newGranule.files.map((file) => {
          const translatedFile = translateApiFiletoPostgresFile(file);
          translatedFile.granule_cumulus_id = upsertedGranule[0].cumulus_id;
          return translatedFile;
        }));
      }
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

  const providerPgModel = new ProviderPgModel();
  return await Promise.all(
    providers.map(async (provider) => {
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

  const rulePgModel = new RulePgModel();
  return await Promise.all(
    rules.map(async (r) => {
      const ruleRecord = await createRuleTrigger(r);
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
    const dbRecord = await translateApiExecutionToPostgresExecution(execution, knex);
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

  const pdrPgModel = new PdrPgModel();
  return await Promise.all(
    pdrs.map(async (p) => {
      const dbRecord = await translateApiPdrToPostgresPdr(p, knex);
      await pdrPgModel.create(knex, dbRecord);
    })
  );
}

async function addReconciliationReports(reconciliationReports) {
  const knex = await getKnexClient({
    env: {
      ...envParams,
      ...localStackConnectionEnv,
    },
  });
  const reconciliationReportPgModel = new ReconciliationReportPgModel();
  return await Promise.all(
    reconciliationReports.map(async (r) => {
      const dbRecord = await translateApiReconReportToPostgresReconReport(r, knex);
      await reconciliationReportPgModel.create(knex, dbRecord);
    })
  );
}

module.exports = {
  resetPostgresDb,
  addAsyncOperations,
  addProviders,
  addCollections,
  addExecutions,
  addGranules,
  addPdrs,
  addReconciliationReports,
  addRules,
  erasePostgresTables,
};
