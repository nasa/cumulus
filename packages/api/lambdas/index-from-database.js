'use strict';

const log = require('@cumulus/common/log');

const {
  DynamoDbSearchQueue
} = require('@cumulus/common/aws');

async function indexModel(tableName) {
  const scanQueue = new DynamoDbSearchQueue({
    TableName: tableName,
    Limit: 1
  });

  await scanQueue.fetchItems();

  console.log(scanQueue.items);
}

async function testIndex() {
  await indexModel(process.env.ExecutionsTable);
}

function handler(event) {
  log.info('Start reindex from database');

  return 'done';
}

module.exports = {
  handler,
  testIndex
};
