'use strict';

const pLimit = require('p-limit');

const DynamoDbSearchQueue = require('@cumulus/aws-client/DynamoDbSearchQueue');
const log = require('@cumulus/common/log');

const { Search } = require('../es/search');
const indexer = require('../es/indexer');

const getEsRequestConcurrency = (event) =>
  event.esRequestConcurrency
  || parseInt(process.env.ES_CONCURRENCY, 10)
  || 10;

async function indexModel({
  esClient,
  tableName,
  esIndex,
  indexFn,
  limitEsRequests
}) {
  const scanQueue = new DynamoDbSearchQueue({
    TableName: tableName
  });

  let itemsComplete = false;

  /* eslint-disable no-await-in-loop */
  while (itemsComplete === false) {
    await scanQueue.fetchItems();

    itemsComplete = scanQueue.items[scanQueue.items.length - 1] === null;

    if (itemsComplete) {
      // pop the null item off
      scanQueue.items.pop();
    }

    log.info(`Indexing ${scanQueue.items.length} records from ${tableName}`);
    const input = scanQueue.items.map(
      (item) => limitEsRequests(
        () => indexFn(esClient, item, esIndex)
      )
    );
    await Promise.all(input);

    log.info(`Completed index of ${scanQueue.items.length} records from ${tableName}`);
  }
  /* eslint-enable no-await-in-loop */
}

async function indexFromDatabase({
  esIndex,
  tables,
  esHost,
  esRequestConcurrency
}) {
  const esClient = await Search.es(esHost);
  const limitEsRequests = pLimit(esRequestConcurrency);

  await Promise.all([
    indexModel({
      esClient,
      tableName: tables.collectionsTable,
      esIndex,
      indexFn: indexer.indexCollection,
      limitEsRequests
    }),
    indexModel({
      esClient,
      tableName: tables.executionsTable,
      esIndex,
      indexFn: indexer.indexExecution,
      limitEsRequests
    }),
    indexModel({
      esClient,
      tableName: tables.asyncOperationsTable,
      esIndex,
      indexFn: indexer.indexAsyncOperation,
      limitEsRequests
    }),
    indexModel({
      esClient,
      tableName: tables.granulesTable,
      esIndex,
      indexFn: indexer.indexGranule,
      limitEsRequests
    }),
    indexModel({
      esClient,
      tableName: tables.pdrsTable,
      esIndex,
      indexFn: indexer.indexPdr,
      limitEsRequests
    }),
    indexModel({
      esClient,
      tableName: tables.providersTable,
      esIndex,
      indexFn: indexer.indexProvider,
      limitEsRequests
    }),
    indexModel({
      esClient,
      tableName: tables.rulesTable,
      esIndex,
      indexFn: indexer.indexRule,
      limitEsRequests
    })
  ]);
}

async function handler(event) {
  log.info(`Starting index from database for index ${event.indexName}`);

  const {
    index,
    tables,
    esHost = process.env.ES_HOST
  } = event;

  await indexFromDatabase({
    indexName: index,
    tables,
    esHost,
    esRequestConcurrency: getEsRequestConcurrency(event)
  });

  log.info('Index from database complete');

  return 'Index from database complete';
}

module.exports = {
  handler,
  indexFromDatabase,
  getEsRequestConcurrency
};
