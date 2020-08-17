'use strict';

const isNil = require('lodash/isNil');
const pLimit = require('p-limit');

const DynamoDbSearchQueue = require('@cumulus/aws-client/DynamoDbSearchQueue');
const log = require('@cumulus/common/log');

const { Search } = require('../es/search');
const indexer = require('../es/indexer');

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

async function indexModel({
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

async function indexFromDatabase(event) {
  const {
    indexName: esIndex,
    tables,
    esHost = process.env.ES_HOST,
  } = event;
  const esClient = await Search.es(esHost);

  const esRequestConcurrency = getEsRequestConcurrency(event);
  const limitEsRequests = pLimit(esRequestConcurrency);

  await Promise.all([
    indexModel({
      esClient,
      tableName: tables.collectionsTable,
      esIndex,
      indexFn: indexer.indexCollection,
      limitEsRequests,
    }),
    indexModel({
      esClient,
      tableName: tables.executionsTable,
      esIndex,
      indexFn: indexer.indexExecution,
      limitEsRequests,
    }),
    indexModel({
      esClient,
      tableName: tables.asyncOperationsTable,
      esIndex,
      indexFn: indexer.indexAsyncOperation,
      limitEsRequests,
    }),
    indexModel({
      esClient,
      tableName: tables.granulesTable,
      esIndex,
      indexFn: indexer.indexGranule,
      limitEsRequests,
    }),
    indexModel({
      esClient,
      tableName: tables.pdrsTable,
      esIndex,
      indexFn: indexer.indexPdr,
      limitEsRequests,
    }),
    indexModel({
      esClient,
      tableName: tables.providersTable,
      esIndex,
      indexFn: indexer.indexProvider,
      limitEsRequests,
    }),
    indexModel({
      esClient,
      tableName: tables.reconciliationReportsTable,
      esIndex,
      indexFn: indexer.indexReconciliationReport,
      limitEsRequests,
    }),
    indexModel({
      esClient,
      tableName: tables.rulesTable,
      esIndex,
      indexFn: indexer.indexRule,
      limitEsRequests,
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
