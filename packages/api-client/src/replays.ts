import { MigrationCountsPayload } from '@cumulus/types/api/migrationCounts';
import { ReplaySqsMessagesPayload } from '@cumulus/types/api/replaySqsMessages';
import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

/**
 * POST a request to start a replay of Kinesis message
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.payload      - payload to post to the endpoint
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the API lambda
 */
export const postKinesisReplays = async (params: {
  prefix: string,
  payload: MigrationCountsPayload
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, payload, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/replays',
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: 202,
  });
};

/**
 * POST a request to start replaying archived SQS Messages
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.payload      - payload to post to the endpoint
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the API lambda
 */
export const replaySqsMessages = async (params: {
  prefix: string,
  payload: ReplaySqsMessagesPayload,
  callback?: InvokeApiFunction,
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { payload, prefix, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/replays/sqs',
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: 202,
  });
};
