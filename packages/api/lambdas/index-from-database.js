'use strict';

const log = require('@cumulus/common/log');

const {
  DynamoDbSearchQueue
} = require('@cumulus/common/aws');

const { Search } = require('../es/search');
const indexer = require('../es/indexer');

async function indexModel(esClient, tableName, esIndex, indexFn) {
  const scanQueue = new DynamoDbSearchQueue({
    TableName: tableName
  });

  let itemsComplete = false;

  /* eslint-disable no-await-in-loop */
  while (itemsComplete === false) {
    log.info(`Indexing ${scanQueue.items.length} records from ${tableName}`);

    await scanQueue.fetchItems();

    itemsComplete = scanQueue.items[scanQueue.items.length - 1] === null;

    if (itemsComplete) {
      // pop the null item off
      scanQueue.items.pop();
    }

    await Promise.all(scanQueue.items.map((item) => indexFn(esClient, item, esIndex)));
  }
  /* eslint-enable no-await-in-loop */
}

async function indexFromDatabase(esIndex) {
  const esClient = await Search.es();

  await Promise.all([
    indexModel(esClient, process.env.CollectionsTable, esIndex, indexer.indexCollection),
    indexModel(esClient, process.env.ExecutionsTable, esIndex, indexer.indexExecution),
    indexModel(esClient, process.env.GranulesTable, esIndex, indexer.indexGranule),
    indexModel(esClient, process.env.PdrsTable, esIndex, indexer.indexPdr),
    indexModel(esClient, process.env.ProvidersTable, esIndex, indexer.indexProvider),
    indexModel(esClient, process.env.RulesTable, esIndex, indexer.indexRule)
  ]);
}

async function handler(event) {
  log.info(`Starting index from database for index ${event.index}`);

  await indexFromDatabase(event.index);

  log.info('Index from database complete');
}

module.exports = {
  handler,
  indexFromDatabase
};
