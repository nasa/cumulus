'use strict';

/**
 * Utility functions for working with the AWS DynamoDb API
 * @module DynamoDb
 *
 * @example
 * const DynamoDb = require('@cumulus/common/DynamoDb');
 */

const aws = require('./aws');
const { RecordDoesNotExist } = require('./errors');

// Exported functions

/**
 * Call DynamoDb getItem
 *
 * See [DynamoDb.getItem()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#getItem-property)
 * for descriptions of `params` and the return data.
 *
 * @param {Object} params
 * @returns {Promise.<Object>}
 * @throws {RecordDoesNotExist} if a record cannot be found
 *
 * @static
 * @kind function
 */
const getItem = aws.improveStackTrace(
  async ({
    tableName,
    item,
    client
  }) => {
    const params = {
      TableName: tableName,
      Key: item
    };

    try {
      const getResponse = await client.get(params).promise();
      if (!getResponse.Item) {
        throw new RecordDoesNotExist();
      }
      return getResponse.Item;
    } catch (e) {
      throw new RecordDoesNotExist(
        `No record found for ${JSON.stringify(item)} in ${tableName}`
      );
    }
  }
);

/**
 * Call DynamoDb scan
 *
 * See [DynamoDb.scan()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#scan-property)
 * for descriptions of `params` and the return data.
 *
 * @param {Object} params
 * @returns {Promise.<Object>}
 *
 * @static
 * @kind function
 */
const scan = aws.improveStackTrace(
  async ({
    tableName,
    query,
    fields,
    limit,
    select,
    startKey
  }) => {
    const params = {
      TableName: tableName
    };

    if (query) {
      if (query.filter && query.values) {
        params.FilterExpression = query.filter;
        params.ExpressionAttributeValues = query.values;
      }

      if (query.names) {
        params.ExpressionAttributeNames = query.names;
      }
    }

    if (fields) {
      params.ProjectionExpression = fields;
    }

    if (limit) {
      params.Limit = limit;
    }

    if (select) {
      params.Select = select;
    }

    if (startKey) {
      params.ExclusiveStartKey = startKey;
    }

    const response = await this.dynamodbDocClient.scan(params).promise();

    // recursively go through all the records
    if (response.LastEvaluatedKey) {
      const more = await this.scan(query, fields, limit, select, response.LastEvaluatedKey);
      if (more.Items) {
        response.Items = more.Items.concat(more.Items);
      }
      response.Count += more.Count;
    }

    return response;
  }
);

module.exports = {
  getItem,
  scan
};
