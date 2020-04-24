/**
 * Utility functions for working with the AWS DynamoDb API
 */
import { RecordDoesNotExist } from '@cumulus/errors';
import { dynamodb } from './services';
import { improveStackTrace } from './utils';

/**
 * Call DynamoDb client get
 *
 * See [DocumentClient.get()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#get-property)
 * for descriptions of `params` and the return data.
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
      tableName
    } = params;

    const getResponse = await client.get({
      ...getParams,
      TableName: tableName,
      Key: item
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
      tableName
    } = params;

    const scanParams: AWS.DynamoDB.DocumentClient.ScanInput = {
      TableName: tableName
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
        startKey: response.LastEvaluatedKey
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
 * @param params - the same params that you would pass to AWS.createTable
 *   See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#createTable-property
 * @returns the output of the createTable call
 */
export async function createAndWaitForDynamoDbTable(params: AWS.DynamoDB.CreateTableInput) {
  const createTableResult = await dynamodb().createTable(params).promise();
  await dynamodb().waitFor('tableExists', { TableName: params.TableName }).promise();

  return createTableResult;
}

/**
 * Delete a DynamoDB table and then wait for the table to not exist
 *
 * @param params - the same params that you would pass to AWS.deleteTable
 *   See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#deleteTable-property
 */
export async function deleteAndWaitForDynamoDbTableNotExists(
  params: AWS.DynamoDB.DeleteTableInput
) {
  await dynamodb().deleteTable(params).promise();
  return dynamodb().waitFor('tableNotExists', { TableName: params.TableName }).promise();
}
