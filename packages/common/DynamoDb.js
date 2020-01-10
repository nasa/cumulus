'use strict';

const DynamoDb = require('@cumulus/aws-client/DynamoDb');
const { deprecate } = require('./util');

// Exported functions

/**
 * Call DynamoDb client get
 *
 * See [DocumentClient.get()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#get-property)
 * for descriptions of `params` and the return data.
 *
 * @param {Object} params
 * @returns {Promise.<Object>}
 * @throws {RecordDoesNotExist} if a record cannot be found
 *
 * @static
 * @kind function
 */
const get = async ({
  tableName,
  item,
  client
}) => {
  deprecate('@cumulus/common/DynamoDb.get', '1.17.1', '@cumulus/aws-client/DynamoDb.get');
  return DynamoDb.get({
    tableName,
    item,
    client
  });
};

/**
 * Call DynamoDb client scan
 *
 * See [DocumentClient.scan()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#scan-property)
 * for descriptions of `params` and the return data.
 *
 * @param {Object} params
 * @returns {Promise.<Object>}
 *
 * @static
 * @kind function
 */
const scan = async ({
  tableName,
  client,
  query,
  fields,
  limit,
  select,
  startKey
}) => {
  deprecate('@cumulus/common/DynamoDb.scan', '1.17.1', '@cumulus/aws-client/DynamoDb.scan');
  return DynamoDb.scan({
    tableName,
    client,
    query,
    fields,
    limit,
    select,
    startKey
  });
};

module.exports = {
  get,
  scan
};
