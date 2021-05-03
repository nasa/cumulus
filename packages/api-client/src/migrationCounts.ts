import { MigrationCountsPayload } from '@cumulus/types/api/migrationCounts';
import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

/**
 * POST a request to start a migrationCounts run
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
export const postMigrationCounts = async (params: {
  prefix: string,
  payload: MigrationCountsPayload
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, payload, callback = invokeApi } = params;

  return callback({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/migrationCounts',
      body: JSON.stringify(payload),
    },
  });
};
