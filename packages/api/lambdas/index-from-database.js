'use strict';

const isNil = require('lodash/isNil');
const pLimit = require('p-limit');

const log = require('@cumulus/common/log');

const { getEsClient } = require('@cumulus/es-client/search');
const {
  CollectionPgModel,
  ExecutionPgModel,
  AsyncOperationPgModel,
  GranulePgModel,
  ProviderPgModel,
  ReconciliationReportPgModel,
  RulePgModel,
  PdrPgModel,
  getKnexClient,
  translatePostgresCollectionToApiCollection,
  translatePostgresExecutionToApiExecution,
  translatePostgresAsyncOperationToApiAsyncOperation,
  translatePostgresGranuleToApiGranule,
  translatePostgresProviderToApiProvider,
  translatePostgresPdrToApiPdr,
  translatePostgresReconReportToApiReconReport,
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

/**
* indexModel - Index a postgres RDS table's contents to ElasticSearch
*
* @param {Object} params                  -- parameters
* @param {any} params.esClient            -- ElasticSearch client
* @param {any} params.postgresModel       -- @cumulus/db model
* @param {string} params.esIndex          -- esIndex to write records to
* @param {any} params.indexFn             -- Indexer function that maps to the database model
* @param {any} params.limitEsRequests     -- limitEsRequests method (used for testing)
* @param {Knex} params.knex               -- configured knex instance
* @param {any} params.translationFunction -- function to translate postgres record
*                                            to API record for ES
* @param {number} params.pageSize         -- Page size for postgres pagination
* @returns {number}                       -- number of items indexed
*/
async function indexModel({
  esClient,
  postgresModel,
  esIndex,
  indexFn,
  limitEsRequests,
  knex,
  translationFunction,
  pageSize,
}) {
  let startId = 1;
  let totalItemsIndexed = 0;
  let done;
  let maxIndex = await postgresModel.getMaxCumulusId(knex);
  let failCount = 0;

  log.info(`Starting index of ${postgresModel.tableName} with max cumulus_id of ${maxIndex}`);
  /* eslint-disable no-await-in-loop */
  while (done !== true && maxIndex > 0) {
    const pageResults = await postgresModel.paginateByCumulusId(knex, startId, pageSize);
    log.info(
      `Attempting to index ${pageResults.length} records from ${postgresModel.tableName}`
    );

    const indexPromises = pageResults.map((pageResult) => limitEsRequests(async () => {
      let translationResult;
      try {
        translationResult = await translationFunction(pageResult);
        await esClient.refreshClient();
        return await indexFn(esClient, translationResult, esIndex);
      } catch (error) {
        log.error(
          `Error indexing record ${JSON.stringify(translationResult)}, error: ${error.message}`
        );
        return false;
      }
    }));

    const results = await Promise.all(indexPromises);
    const successfulResults = results.filter((result) => result !== false);
    failCount += (results.length - successfulResults.length);

    totalItemsIndexed += successfulResults.length;

    log.info(`Completed index of ${successfulResults.length} records from ${postgresModel.tableName}`);
    startId += pageSize;
    if (startId > maxIndex) {
      startId = maxIndex;
      log.info(`Continuing indexing from cumulus_id ${startId} to account for new rows from ${postgresModel.tableName}`);
      const oldMaxIndex = maxIndex;
      maxIndex = await postgresModel.getMaxCumulusId(knex);
      if (maxIndex <= oldMaxIndex) {
        done = true;
      }
    }
  }
  /* eslint-enable no-await-in-loop */
  log.info(`Completed successful index of ${totalItemsIndexed} records from ${postgresModel.tableName}`);
  if (failCount) {
    log.warn(`${failCount} records failed indexing from ${postgresModel.tableName}`);
  }
  return totalItemsIndexed;
}

async function indexFromDatabase(event) {
  const {
    indexName: esIndex,
    esHost = process.env.ES_HOST,
    postgresResultPageSize,
    postgresConnectionPoolSize,
  } = event;
  const esClient = await getEsClient(esHost);
  const knex = event.knex || (await getKnexClient({
    env: {
      dbMaxPool: Number.parseInt(postgresConnectionPoolSize, 10) || 10,
      ...process.env,
    },
  }));

  const pageSize = Number.parseInt(postgresResultPageSize, 10) || 1000;
  const esRequestConcurrency = getEsRequestConcurrency(event);
  log.info(
    `Tuning configuration: esRequestConcurrency: ${esRequestConcurrency}, postgresResultPageSize: ${pageSize}, postgresConnectionPoolSize: ${postgresConnectionPoolSize}`
  );

  const limitEsRequests = pLimit(esRequestConcurrency);

  await Promise.all([
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexCollection,
      limitEsRequests,
      postgresModel: new CollectionPgModel(),
      translationFunction: translatePostgresCollectionToApiCollection,
      knex,
      pageSize,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexExecution,
      limitEsRequests,
      postgresModel: new ExecutionPgModel(),
      translationFunction: (record) =>
        translatePostgresExecutionToApiExecution(record, knex),
      knex,
      pageSize,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexAsyncOperation,
      limitEsRequests,
      postgresModel: new AsyncOperationPgModel(),
      translationFunction: translatePostgresAsyncOperationToApiAsyncOperation,
      knex,
      pageSize,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexGranule,
      limitEsRequests,
      postgresModel: new GranulePgModel(),
      translationFunction: (record) =>
        translatePostgresGranuleToApiGranule({
          granulePgRecord: record,
          knexOrTransaction: knex,
        }),
      knex,
      pageSize,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexPdr,
      limitEsRequests,
      postgresModel: new PdrPgModel(),
      translationFunction: (record) =>
        translatePostgresPdrToApiPdr(record, knex),
      knex,
      pageSize,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexProvider,
      limitEsRequests,
      postgresModel: new ProviderPgModel(),
      translationFunction: translatePostgresProviderToApiProvider,
      knex,
      pageSize,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexReconciliationReport,
      limitEsRequests,
      postgresModel: new ReconciliationReportPgModel(),
      translationFunction: translatePostgresReconReportToApiReconReport,
      knex,
      pageSize,
    }),
    indexModel({
      esClient,
      esIndex,
      indexFn: indexer.indexRule,
      limitEsRequests,
      postgresModel: new RulePgModel(),
      translationFunction: (record) =>
        translatePostgresRuleToApiRule(record, knex),
      knex,
      pageSize,
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
