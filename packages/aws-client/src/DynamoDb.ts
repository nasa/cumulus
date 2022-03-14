/**
 * @module DynamoDb
 */

import pMap from 'p-map';
import pRetry from 'p-retry';
import range from 'lodash/range';
import {
  // DynamoDB,
  waitUntilTableExists,
  waitUntilTableNotExists,
  CreateTableInput,
  DeleteTableInput,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocument,
  GetCommandInput,
  ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { DocumentClient } from 'aws-sdk/lib/dynamodb/document_client';

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
export const get = async (
  params: {
    tableName: string,
    item: GetCommandInput['Key'],
    client: DynamoDBDocument,
    getParams?: object
  }
) => {
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
  });

  if (getResponse.Item) return getResponse.Item;

  throw new RecordDoesNotExist(`No record found for ${JSON.stringify(item)} in ${tableName}`);
};

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
    client: DynamoDBDocument,
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

    const response = await client.scan(scanParams);

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
 * Do a parallel scan of DynamoDB table using a document client.
 *
 * See https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html#Scan.ParallelScan.
 * See [DocumentClient.scan()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#scan-property).
 *
 * @param {Object} params
 * @param {number} params.totalSegments
 *   Total number of segments to divide table into for parallel scanning
 * @param {DocumentClient.ScanInput} params.scanParams
 *   Params for the DynamoDB client scan operation
 *   See https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
 * @param {function} params.processItemsFunc - Function used to process returned items by scan
 * @param {DocumentClient} [params.dynamoDbClient] - Instance of Dynamo DB document client
 * @param {pRetry.Options} [params.retryOptions] - Retry options for scan operations
 * @returns {Promise}
 */
export const parallelScan = async (
  params: {
    totalSegments: number,
    scanParams: ScanCommandInput,
    processItemsFunc: (items: DocumentClient.ItemList) => Promise<void>,
    dynamoDbClient: DynamoDBDocument,
    retryOptions?: pRetry.Options,
  }
) => {
  const {
    totalSegments,
    scanParams,
    processItemsFunc,
    dynamoDbClient,
    retryOptions,
  } = params;

  return await pMap(
    range(totalSegments),
    async (_, segmentIndex) => {
      let exclusiveStartKey: DocumentClient.Key | undefined;

      const segmentScanParams: ScanCommandInput = {
        ...scanParams,
        TotalSegments: totalSegments,
        Segment: segmentIndex,
      };

      /* eslint-disable no-await-in-loop */
      do {
        const {
          Items = [],
          LastEvaluatedKey,
        } = await pRetry(
          () => dynamoDbClient.scan(segmentScanParams),
          retryOptions
        );

        exclusiveStartKey = LastEvaluatedKey;
        segmentScanParams.ExclusiveStartKey = exclusiveStartKey;

        await processItemsFunc(Items);
      } while (exclusiveStartKey);
      /* eslint-enable no-await-in-loop */

      return Promise.resolve();
    },
    {
      stopOnError: false,
    }
  );
};

/**
 * Create a DynamoDB table and then wait for the table to exist
 *
 * @param {Object} params - the same params that you would pass to AWS.createTable
 *   See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#createTable-property
 * @returns {Promise<Object>} the output of the createTable call
 *
 * @static
 */
export async function createAndWaitForDynamoDbTable(params: CreateTableInput) {
  const dynamoDbClient = dynamodb();
  const createTableResult = await dynamoDbClient.createTable(params);
  await waitUntilTableExists({
    client: dynamoDbClient,
    minDelay: 1,
    maxWaitTime: 3,
  }, { TableName: params.TableName });
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
  params: DeleteTableInput
) {
  const dynamoDbClient = dynamodb();
  await dynamoDbClient.deleteTable(params);
  try {
    await waitUntilTableNotExists({
      client: dynamoDbClient,
      minDelay: 1,
      maxWaitTime: 3,
    }, { TableName: params.TableName });
  } catch (error) {
    console.log(error);
  }
}
