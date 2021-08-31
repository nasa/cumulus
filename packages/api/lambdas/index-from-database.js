'use strict';

const isNil = require('lodash/isNil');
const pLimit = require('p-limit');

const DynamoDbSearchQueue = require('@cumulus/aws-client/DynamoDbSearchQueue');
const log = require('@cumulus/common/log');

const { Search } = require('@cumulus/es-client/search');
const {
  CollectionPgModel,
  ExecutionPgModel,
  AsyncOperationPgModel,
  GranulePgModel,
  ProviderPgModel,
  RulePgModel,
  PdrPgModel,
  getKnexClient,
  translatePostgresCollectionToApiCollection,
  translatePostgresExecutionToApiExecution,
  translatePostgresAsyncOperationToApiAsyncOperation,
  translatePostgresGranuleToApiGranule,
  translatePostgresProviderToApiProvider,
  translatePostgresPdrToApiPdr,
  translatePostgresRuleToApiRule,
} = require('@cumulus/db');
const indexer = require('@cumulus/es-client/indexer');

/**
 * Return specified concurrency for ES requests.
 *
 * Returned value is used with [p-limit](https://github.com/sindresorhus/p-limit), which
 * does not accept 0.
 *
 * @param {Object} event - Incoming Lambda event
 * @returns {number} - Specified request concurrency. Defaults to 10.
 * @throws {TypeError}
 */
const getEsRequestConcurrency = (event) => {
  if (!isNil(event.esRequestConcurrency)) {
    const parsedValue = Number.parseInt(event.esRequestConcurrency, 10);

    if (Number.isInteger(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }

    throw new TypeError('event.esRequestConcurrency must be an integer greater than 0');
  }

  if (!isNil(process.env.ES_CONCURRENCY)) {
    const parsedValue = Number.parseInt(process.env.ES_CONCURRENCY, 10);

    if (Number.isInteger(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }

    throw new TypeError('The ES_CONCURRENCY environment variable must be an integer greater than 0');
  }

  return 10;
};

// Legacy method for Reconciliation Reports only
async function indexReconciliationReports({
  esClient,
  tableName,
  esIndex,
  indexFn,
  limitEsRequests,
}) {
  const scanQueue = new DynamoDbSearchQueue({
    TableName: tableName,
  });

  let itemsComplete = false;
  let totalItemsIndexed = 0;

  /* eslint-disable no-await-in-loop */
  while (itemsComplete === false) {
    await scanQueue.fetchItems();

    itemsComplete = scanQueue.items[scanQueue.items.length - 1] === null;

    if (itemsComplete) {
      // pop the null item off
      scanQueue.items.pop();
    }

    if (scanQueue.items.length === 0) {
      log.info(`No records to index for ${tableName}`);
      return true;
    }

    log.info(`Attempting to index ${scanQueue.items.length} records from ${tableName}`);

    const input = scanQueue.items.map(
      (item) => limitEsRequests(
        async () => {
          try {
            return await indexFn(esClient, item, esIndex);
          } catch (error) {
            log.error(`Error indexing record ${JSON.stringify(item)}, error: ${error}`);
            return false;
          }
        }
      )
    );
    const results = await Promise.all(input);
    const successfulResults = results.filter((result) => result !== false);
    totalItemsIndexed += successfulResults;

    log.info(`Completed index of ${successfulResults.length} records from ${tableName}`);
  }
  /* eslint-enable no-await-in-loop */

  return totalItemsIndexed;
}

async function indexModel({
  esClient,
  postgresModel,
  esIndex,
  indexFn,
  limitEsRequests,
  knex,
  translationFunction,
}) {
  // TODO - should we support optional reindexing after a
  // particular date (e.g. start at min cumulus ID given a created_at query?)
  let startId = 1;
  let totalItemsIndexed = 0;
  const pageSize = 1;
  let done;
  let maxIndex = await postgresModel.getMaxCumulusId(knex);
  /* eslint-disable no-await-in-loop */
  while (!done) {
    if (startId > maxIndex) {
      log.info('Updating maxIndex to account for new rows');
      const oldMaxIndex = maxIndex;
      maxIndex = await postgresModel.getMaxCumulusId(knex);
      if (maxIndex <= oldMaxIndex) {
        return true;
      }
    }
    const pageResults = await postgresModel.paginateByCumulusId(knex, startId, pageSize);
    log.info(
      `Attempting to index ${pageResults.length} records from ${postgresModel.tableName}`
    );

    const translatedResults = await Promise.all(
      pageResults.map(async (result) => await translationFunction(result))
    );

    const indexPromises = translatedResults.map((result) => limitEsRequests(
      async () => {
        try {
          return await indexFn(esClient, result, esIndex);
        } catch (error) {
          log.error(`Error indexing record ${JSON.stringify(result)}, error: ${error}`);
          return false;
        }
      }
    ));
    const results = await Promise.all(indexPromises);
    const successfulResults = results.filter((result) => result !== false);
    totalItemsIndexed += successfulResults;

    log.info(`Completed index of ${successfulResults.length} records from ${postgresModel.tableName}`);
    startId += pageSize;
  }
  /* eslint-enable no-await-in-loop */
  return totalItemsIndexed;
}

async function indexFromDatabase(event) {
  const knex = event.knex || getKnexClient();
  const {
    indexName: esIndex,
    esHost = process.env.ES_HOST,
    dynamoTables = { reconciliationReportsTable: process.env.ReconciliationReportsTable },
  } = event;
  const esClient = await Search.es(esHost);

  const esRequestConcurrency = getEsRequestConcurrency(event);
  const limitEsRequests = pLimit(esRequestConcurrency);

  // TODO - update these to:
  //pull dynamo record
  //*run translation on them to get an API record*
  // index
  await Promise.all([
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexCollection,
      limitEsRequests,
      postgresModel: new CollectionPgModel(),
      translationFunction: translatePostgresCollectionToApiCollection,
      knex,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexExecution,
      limitEsRequests,
      postgresModel: new ExecutionPgModel(),
      translationFunction: translatePostgresExecutionToApiExecution,
      knex,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexAsyncOperation,
      limitEsRequests,
      postgresModel: new AsyncOperationPgModel(),
      translationFunction: translatePostgresAsyncOperationToApiAsyncOperation,
      knex,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexGranule,
      limitEsRequests,
      postgresModel: new GranulePgModel(),
      translationFunction: (record) => translatePostgresGranuleToApiGranule(record, knex),
      knex,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexPdr,
      limitEsRequests,
      postgresModel: new PdrPgModel(),
      translationFunction: (record) => translatePostgresPdrToApiPdr(record, knex),
      knex,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexProvider,
      limitEsRequests,
      postgresModel: new ProviderPgModel(),
      translationFunction: translatePostgresProviderToApiProvider,
      knex,
    }),
    indexReconciliationReports({
      esClient,
      tableName: dynamoTables.reconciliationReportsTable,
      esIndex,
      indexFn: indexer.indexReconciliationReport,
      limitEsRequests,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexRule,
      limitEsRequests,
      postgresModel: new RulePgModel(),
      translationFunction: translatePostgresRuleToApiRule,
      knex,
    }),
  ]);
}

async function handler(event) {
  log.info(`Starting index from database for index ${event.indexName}`);

  await indexFromDatabase(event);

  log.info('Index from database complete');

  return 'Index from database complete';
}

module.exports = {
  handler,
  indexFromDatabase,
  getEsRequestConcurrency,
};
