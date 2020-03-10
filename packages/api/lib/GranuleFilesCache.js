'use strict';

const chunk = require('lodash.chunk');
const flatten = require('lodash.flatten');
const pick = require('lodash.pick');
const pMap = require('p-map');
const { isNil, noop } = require('@cumulus/common/util');
const { dynamodb, dynamodbDocClient } = require('@cumulus/aws-client/services');
const { isNonEmptyString } = require('@cumulus/common/string');

const cacheTableName = () => {
  if (isNonEmptyString(process.env.FilesTable)) return process.env.FilesTable;
  throw new Error('process.env.FilesTable is not set');
};

const batchUpdate = async (params = {}) => {
  const { puts = [], deletes = [] } = params;

  // Perform input validation
  puts.forEach((put) => {
    ['bucket', 'key', 'granuleId'].forEach((prop) => {
      if (isNil(put[prop])) {
        throw new TypeError(`${prop} is required in put request: ${JSON.stringify(put)}`);
      }
    });
  });

  deletes.forEach((del) => {
    ['bucket', 'key'].forEach((prop) => {
      if (isNil(del[prop])) {
        throw new TypeError(`${prop} is required in delete request: ${JSON.stringify(del)}`);
      }
    });
  });

  // Build the request items
  const putRequests = puts.map(
    (file) => ({
      PutRequest: {
        Item: pick(file, ['bucket', 'key', 'granuleId'])
      }
    })
  );

  const deleteRequests = deletes.map(
    (file) => ({
      DeleteRequest: {
        Key: pick(file, ['bucket', 'key'])
      }
    })
  );

  const requestItems = flatten([putRequests, deleteRequests]);

  if (requestItems.length === 0) return;

  // Perform the batch writes 25 at a time
  await pMap(
    chunk(requestItems, 25),
    (items) =>
      dynamodbDocClient().batchWrite({
        RequestItems: { [cacheTableName()]: items }
      }).promise()
  );
};

const createCacheTable = async () => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('This function is for use in tests only');
  }

  await dynamodb().createTable({
    TableName: cacheTableName(),
    AttributeDefinitions: [
      { AttributeName: 'bucket', AttributeType: 'S' },
      { AttributeName: 'key', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'bucket', KeyType: 'HASH' },
      { AttributeName: 'key', KeyType: 'RANGE' }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  }).promise();

  await dynamodb().waitFor(
    'tableExists',
    { TableName: cacheTableName() }
  ).promise();
};

const deleteCacheTable = async () => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('This function is for use in tests only');
  }

  await dynamodb().deleteTable({ TableName: cacheTableName() }).promise()
    .catch(noop);
};

const getGranuleId = async (bucket, key) => {
  const getResponse = await dynamodbDocClient().get({
    TableName: cacheTableName(),
    Key: { bucket, key }
  }).promise();

  return getResponse.Item ? getResponse.Item.granuleId : null;
};

const put = async (file) => {
  await dynamodbDocClient().put({
    TableName: cacheTableName(),
    Item: file
  }).promise();
};

const del = async ({ bucket, key }) => {
  await dynamodbDocClient().delete({
    TableName: cacheTableName(),
    Key: { bucket, key }
  }).promise();
};

module.exports = {
  batchUpdate,
  cacheTableName,
  createCacheTable,
  del,
  deleteCacheTable,
  getGranuleId,
  put
};
