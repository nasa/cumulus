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
 * @kind function
 */
const get = (params) => {
  deprecate('@cumulus/common/DynamoDb.get', '1.17.0', '@cumulus/aws-client/DynamoDb.get');
  return DynamoDb.get(params);
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
 * @kind function
 */
const scan = (params) => {
  deprecate('@cumulus/common/DynamoDb.scan', '1.17.0', '@cumulus/aws-client/DynamoDb.scan');
  return DynamoDb.scan(params);
};

module.exports = {
  get,
  scan
};
