import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

/**
 * Post a request to index from database on the elasticsearch endpoint
 * POST /elasticsearch/index-from-database
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {Object} params.body       - request body to post
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApifunction to invoke the api lambda
 * @returns {Promise<Object>}        - promise that resolves to the output of the API lambda
 */
export async function indexFromDatabase(params: {
  prefix: string,
  body: unknown,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> {
  const { prefix, body, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/elasticsearch/index-from-database',
      body: JSON.stringify(body),
    },
  });
}
