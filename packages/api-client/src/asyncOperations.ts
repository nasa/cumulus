import { invokeApi } from './cumulusApiClient';
import { InvokeApiFunction, ApiGatewayLambdaHttpProxyResponse } from './types';

/**
 * Get /asyncOperations/{asyncOperationId}
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.asyncOperationId - the async operation id
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - the response from the callback
 */
export const getAsyncOperation = async (params: {
  prefix: string,
  asyncOperationId: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, asyncOperationId, callback = invokeApi } = params;

  return callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/asyncOperations/${asyncOperationId}`,
    },
  });
};


/**
 * Query  async operations stored in cumulus
 * GET /granules
 * @param {Object} params             - params
 * @param {string} [params.query]     - query to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const listAsyncOperations = async (params: {
  prefix: string,
  query?: {
    fields?: string[],
    [key: string]: string | string[] | undefined
  },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, query, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/asyncOperations',
      queryStringParameters: query,
    },
  });
};
