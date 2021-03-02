import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

/**
 * Query orca recovery requests
 * GET /orca
 * @param {Object} params             - params
 * @param {string} [params.query]     - query to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const listRequests = async (params: {
  prefix: string,
  query?: { [key: string]: string },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, query, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/orca',
      queryStringParameters: query,
    },
  });
};
