import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, HttpMethod, InvokeApiFunction } from './types';

/**
 * Query orca recovery requests
 * GET /orca/recovery
 * @param {Object} params             - params
 * @param {string} [params.query]     - query to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const submitRequestToOrca = async (params: {
  prefix: string,
  httpMethod: HttpMethod,
  path: string,
  body: object,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, httpMethod, path, body, callback = invokeApi } = params;
  return await callback({
    prefix: prefix,
    payload: {
      httpMethod,
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path,
      body: JSON.stringify(body),
    },
  });
};
