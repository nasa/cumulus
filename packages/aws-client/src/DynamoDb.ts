/**
 * @module DynamoDb
 */

import { RecordDoesNotExist } from '@cumulus/errors';
import { dynamodb } from './services';
import { improveStackTrace } from './utils';

/**
 * Call DynamoDb client get
 *
 * See [DocumentClient.get()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#get-property)
 * for descriptions of `params` and the return data.
 *
 * @param {Object} params
 * @param {string} params.tableName - Table name to read
 * @param {AWS.DynamoDB.DocumentClient.Key} params.item - Key identifying object to get
 * @param {AWS.DynamoDB.DocumentClient} params.client - Instance of a DynamoDb DocumentClient
 * @param {Object} params.getParams - Additional parameters for DocumentClient.get()
 * @returns {Promise<Object>}
 * @throws {RecordDoesNotExist} if a record cannot be found
 */
export const get = improveStackTrace(
  async (params: {
    tableName: string,
    item: AWS.DynamoDB.DocumentClient.Key,
    client: AWS.DynamoDB.DocumentClient,
    getParams?: object
  }) => {
    const {
      client,
      getParams = {},
      item,
      tableName,
    } = params;

    const getResponse = await client.get({
      ...getParams,
      TableName: tableName,
      Key: item,
    }).promise();

    if (getResponse.Item) return getResponse.Item;

    throw new RecordDoesNotExist(`No record found for ${JSON.stringify(item)} in ${tableName}`);
  }
);

/**
 * Call DynamoDb client scan
 *
 * See [DocumentClient.scan()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#scan-property)
 * for descriptions of `params` and the return data.
 *
 * @param {Object} params
 * @returns {Promise<Object>}
 */
export const scan = improveStackTrace(
  async (params: {
    tableName: string,
    client: AWS.DynamoDB.DocumentClient,
    query?: {
      filter?: string,
      names?: AWS.DynamoDB.DocumentClient.ExpressionAttributeNameMap,
      values?: AWS.DynamoDB.DocumentClient.ExpressionAttributeValueMap,
    },
    fields?: string,
    limit?: number,
    select: string,
    startKey?: AWS.DynamoDB.DocumentClient.Key
  }) => {
    const {
      client,
      fields,
      limit,
      query,
      select,
      startKey,
      tableName,
    } = params;

    const scanParams: AWS.DynamoDB.DocumentClient.ScanInput = {
      TableName: tableName,
    };

    if (query) {
      if (query.filter && query.values) {
        scanParams.FilterExpression = query.filter;
        scanParams.ExpressionAttributeValues = query.values;
      }

      if (query.names) {
        scanParams.ExpressionAttributeNames = query.names;
      }
    }

    if (fields) {
      scanParams.ProjectionExpression = fields;
    }

    if (limit) {
      scanParams.Limit = limit;
    }

    if (select) {
      scanParams.Select = select;
    }

    if (startKey) {
      scanParams.ExclusiveStartKey = startKey;
    }

    const response = await client.scan(scanParams).promise();

    // recursively go through all the records
    if (response.LastEvaluatedKey) {
      const more = await scan({
        tableName,
        client,
        query,
        fields,
        limit,
        select,
        startKey: response.LastEvaluatedKey,
      });

      if (more.Items) {
        response.Items = (response.Items || []).concat(more.Items);
      }

      if (typeof response.Count === 'number' && typeof more.Count === 'number') {
        response.Count += more.Count;
      }
    }

    return response;
  }
);

/**
 * Create a DynamoDB table and then wait for the table to exist
 *
 * @param {Object} params - the same params that you would pass to AWS.createTable
 *   See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#createTable-property
 * @returns {Promise<Object>} the output of the createTable call
 *
 * @static
 */
export async function createAndWaitForDynamoDbTable(params: AWS.DynamoDB.CreateTableInput) {
  const createTableResult = await dynamodb().createTable(params).promise();
  await dynamodb().waitFor('tableExists', { TableName: params.TableName }).promise();

  return createTableResult;
}

/**
 * Delete a DynamoDB table and then wait for the table to not exist
 *
 * @param {Object} params - the same params that you would pass to AWS.deleteTable
 *   See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#deleteTable-property
 * @returns {Promise}
 *
 * @static
 */
export async function deleteAndWaitForDynamoDbTableNotExists(
  params: AWS.DynamoDB.DeleteTableInput
) {
  await dynamodb().deleteTable(params).promise();
  return dynamodb().waitFor('tableNotExists', { TableName: params.TableName }).promise();
}
