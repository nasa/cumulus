import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

/**
 * Create a provider via the API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.provider   - provider object
 * @param {Function} params.callback - function to invoke the api lambda
 *                                     that takes a prefix / user payload
 * @returns {Promise<Object>}        - promise that resolves to the output of the callback
 */
export const createProvider = async (params: {
  prefix: string,
  provider: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, provider, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path: '/providers',
      body: JSON.stringify(provider),
    },
  });
};

/**
 * Delete a provider from the Cumulus API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.providerId   - a provider id
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the callback
 */
export const deleteProvider = async (params: {
  prefix: string,
  providerId: string,
  expectedStatusCodes: number[],
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { expectedStatusCodes = 200, prefix, providerId, callback = invokeApi } = params;

  return await callback({
    expectedStatusCodes,
    prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/providers/${encodeURIComponent(providerId)}`,
    },
  });
};

/**
 * Fetch a provider from the Cumulus API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.providerId   - a provider id
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the API lambda
 */
export const getProvider = async (params: {
  prefix: string,
  providerId: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, providerId, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/providers/${encodeURIComponent(providerId)}`,
    },
  });
};

/**
 * Fetch a list of providers from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Object} [params.queryStringParameters] - query string parameters to
 *   include in the request
 * @param {Function} [params.callback=invokeApi] - async function to invoke the
 *   api lambda that takes a prefix / user payload.
 * @returns {Promise<Object>} - the list of providers fetched by the API
 */
export const getProviders = async (params: {
  prefix: string,
  queryStringParameters?: {
    fields?: string[],
    [key: string]: string | string[] | undefined
  }
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, queryStringParameters, callback = invokeApi } = params;

  // TODO consider making this more consistent with other api-client methods
  return await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/providers',
      queryStringParameters,
    },
  });
};
