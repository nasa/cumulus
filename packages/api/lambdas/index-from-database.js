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
    indexModel(esClient, process.env.ExecutionsTable, esIndex, indexer.indexExecution),
    indexModel(esClient, process.env.CollectionsTable, esIndex, indexer.indexCollection)
  ]);
}

async function handler(event) {
  log.info('Starting index from database');

  await indexFromDatabase(event.index);

  return 'done';
}

module.exports = {
  handler,
  indexFromDatabase
};
