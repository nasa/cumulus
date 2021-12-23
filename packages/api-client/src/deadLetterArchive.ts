import { DeadLetterArchivePayload } from '@cumulus/types/api/dead_letters';
import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

/**
 * POST a request to start a dead letter processing run
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
export const postRecoverCumulusMessages = async (params: {
  prefix: string,
  payload: DeadLetterArchivePayload,
  callback?: InvokeApiFunction,
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
      path: '/deadLetterArchive/recoverCumulusMessages',
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: 202,
  });
};
