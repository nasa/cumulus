/**
 * @module DynamoDb
 */

import pMap from 'p-map';
import pRetry from 'p-retry';
import range from 'lodash/range';
import {
  waitUntilTableExists,
  waitUntilTableNotExists,
  CreateTableInput,
  DeleteTableInput,
  ScanInput,
  Select,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocument,
  GetCommandInput,
  ScanCommandInput,
  ScanCommandOutput,
} from '@aws-sdk/lib-dynamodb';

import { RecordDoesNotExist } from '@cumulus/errors';
import { dynamodb } from './services';
import { improveStackTrace } from './utils';

/**
 * Call DynamoDb client get
 *
 * See [DocumentClient.get()](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/modules/_aws_sdk_lib_dynamodb.html)
 * for descriptions of `params` and the return data.
 *
 * @param {Object} params
 * @param {string} params.tableName - Table name to read
 * @param {GetCommandInput.Key} params.item - Key identifying object to get
 * @param {DynamoDBDocument} params.client - Instance of a DynamoDb DocumentClient
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
 * See [DocumentClient.scan()](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/modules/_aws_sdk_lib_dynamodb.html)
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
      names?: ScanInput['ExpressionAttributeNames'],
      values?: ScanCommandInput['ExpressionAttributeValues'],
    },
    fields?: string,
    limit?: number,
    select: Select,
    startKey?: ScanInput['ExclusiveStartKey']
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

    const scanParams: ScanInput = {
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
 * See [DocumentClient.scan()](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/modules/_aws_sdk_lib_dynamodb.html).
 *
 * @param {Object} params
 * @param {number} params.totalSegments
 *   Total number of segments to divide table into for parallel scanning
 * @param {ScanInput} params.scanParams
 *   Params for the DynamoDB client scan operation
 *   See https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
 * @param {function} params.processItemsFunc - Function used to process returned items by scan
 * @param {DynamoDBDocument} [params.dynamoDbClient] - Instance of Dynamo DB document client
 * @param {pRetry.Options} [params.retryOptions] - Retry options for scan operations
 * @returns {Promise}
 */
export const parallelScan = async (
  params: {
    totalSegments: number,
    scanParams: ScanCommandInput,
    processItemsFunc: (items: ScanCommandOutput['Items']) => Promise<void>,
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
      let exclusiveStartKey: ScanInput['ExclusiveStartKey'] | undefined;

      const segmentScanParams: ScanInput = {
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
 *   See https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/classes/dynamodb.html#createtable
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
 *   See https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/classes/dynamodb.html#deletetable
 * @returns {Promise}
 *
 * @static
 */
export async function deleteAndWaitForDynamoDbTableNotExists(
  params: DeleteTableInput
) {
  const dynamoDbClient = dynamodb();
  await dynamoDbClient.deleteTable(params);
  await waitUntilTableNotExists({
    client: dynamoDbClient,
    minDelay: 1,
    maxWaitTime: 3,
  }, { TableName: params.TableName });
}
