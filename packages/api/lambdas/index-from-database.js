'use strict';

const log = require('@cumulus/common/log');
const pLimit = require('p-limit');
const limit = pLimit(process.env.ES_CONCURRENCY || 10);

const DynamoDbSearchQueue = require('@cumulus/aws-client/DynamoDbSearchQueue');

const { Search } = require('../es/search');
const indexer = require('../es/indexer');

async function indexModel(esClient, tableName, esIndex, indexFn) {
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
    const input = scanQueue.items.map((item) => limit(() => indexFn(esClient, item, esIndex)));
    await Promise.all(input);

    log.info(`Completed index of ${scanQueue.items.length} records from ${tableName}`);
  }
  /* eslint-enable no-await-in-loop */
}

async function indexFromDatabase(esIndex, tables, esHost) {
  const esClient = await Search.es(esHost);

  await Promise.all([
    indexModel(esClient, tables.collectionsTable, esIndex, indexer.indexCollection),
    indexModel(esClient, tables.executionsTable, esIndex, indexer.indexExecution),
    indexModel(esClient, tables.asyncOperationsTable, esIndex, indexer.indexAsyncOperation),
    indexModel(esClient, tables.granulesTable, esIndex, indexer.indexGranule),
    indexModel(esClient, tables.pdrsTable, esIndex, indexer.indexPdr),
    indexModel(esClient, tables.providersTable, esIndex, indexer.indexProvider),
    indexModel(esClient, tables.rulesTable, esIndex, indexer.indexRule)
  ]);
}

async function handler(event) {
  log.info(`Starting index from database for index ${event.indexName}`);

  await indexFromDatabase(event.indexName, event.tables, event.esHost || process.env.ES_HOST);

  log.info('Index from database complete');

  return 'Index from database complete';
}

module.exports = {
  handler,
  indexFromDatabase
};
