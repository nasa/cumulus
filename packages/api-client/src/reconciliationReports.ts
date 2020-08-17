import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

/**
 * GET /reconciliationReports/{name}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.name        - report record name
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the report fetched by the API
 */
export const getReconciliationReport = async (params: {
  prefix: string,
  name: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, name, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/reconciliationReports/${name}`,
    },
  });
};

/**
 * Delete a reconciliation report from Cumulus via the API lambda
 * DELETE /reconciliationReports/${name}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.name        - report record name
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApi function to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the delete confirmation from the API
 */
export const deleteReconciliationReport = async (params: {
  prefix: string,
  name: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, name, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/reconciliationReports/${name}`,
    },
  });
};

/**
 * Post a request to the reconciliationReports API
 * POST /reconciliationReports
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {Object} params.request    - request body to post
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                   that takes a prefix / user payload.  Defaults
 *                                   to cumulusApiClient.invokeApifunction to invoke the api lambda
 * @returns {Promise<Object>}        - promise that resolves to the output of the API lambda
 */
export async function createReconciliationReport(params: {
  prefix: string,
  request: unknown,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> {
  const { prefix, request, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/reconciliationReports',
      body: JSON.stringify(request),
    },
  });
}
