'use strict';

const DynamoDb = require('@cumulus/aws-client/DynamoDb');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { improveStackTrace } = require('./aws');
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
const get = improveStackTrace(
  async ({
    tableName,
    item,
    client
  }) => {
    deprecate('@cumulus/common/DynamoDb.get', '1.17.0', '@cumulus/aws-client/DynamoDb.get');

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
      if (e instanceof RecordDoesNotExist) {
        throw new RecordDoesNotExist(
          `No record found for ${JSON.stringify(item)} in ${tableName}`
        );
      }
      throw e;
    }
  }
);

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
const scan = improveStackTrace(
  async ({
    tableName,
    client,
    query,
    fields,
    limit,
    select,
    startKey
  }) => {
    deprecate('@cumulus/common/DynamoDb.scan', '1.17.0', '@cumulus/aws-client/DynamoDb.scan');

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

    const response = await client.scan(params).promise();

    // recursively go through all the records
    if (response.LastEvaluatedKey) {
      const more = await scan({
        tableName,
        client,
        query,
        fields,
        limit,
        select,
        startKey: response.LastEvaluatedKey
      });
      if (more.Items) {
        response.Items = response.Items.concat(more.Items);
      }
      response.Count += more.Count;
    }

    return response;
  }
);

module.exports = {
  get,
  scan
};
