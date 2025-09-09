import { ApiExecutionRecord } from '@cumulus/types/api/executions';
import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

/**
 * Fetch an execution from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.arn        - an execution arn
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution fetched by the API
 */
export const getExecution = async (params: {
  prefix: string,
  arn: string,
  callback?: InvokeApiFunction
}): Promise<ApiExecutionRecord> => {
  /* istanbul ignore next */
  const { prefix, arn, callback = invokeApi } = params;

  const response = await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/executions/${arn}`,
    },
  });

  return JSON.parse(response.body);
};

/**
 * Fetch a list of executions from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution list fetched by the API
 */
export const getExecutions = async (params: {
  prefix: string,
  query?: {
    fields?: string[] | string
    [key: string]: string | string[] | undefined
  },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  /* istanbul ignore next */
  const { prefix, query, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/executions',
      queryStringParameters: query,
    },
  });
};

/**
 * get execution status from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.arn        - an execution arn
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution status fetched by the API
 */
export const getExecutionStatus = async (params: {
  prefix: string,
  arn: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  /* istanbul ignore next */
  const { prefix, arn, callback = invokeApi } = params;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/executions/status/${arn}`,
    },
  });
};

export const bulkArchiveExecutions = async (params: {
  prefix: string,
  body: {
    batchSize?: number,
    expirationDays?: number,
  },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  /* istanbul ignore next */
  const { prefix, body, callback = invokeApi } = params;
  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      path: '/executions/archive/',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    expectedStatusCodes: 200,
  });
};

/**
 * Create an execution
 * POST /executions
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.body         - execution object
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - the response from the callback
 */
export const createExecution = async (params: {
  prefix: string,
  body: ApiExecutionRecord,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  /* istanbul ignore next */
  const { prefix, body, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      path: '/executions',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  });
};

/**
 * Update an execution
 * PUT /executions/{executionArn}
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.body         - execution object
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - the response from the callback
 */
export const updateExecution = async (params: {
  prefix: string,
  body: ApiExecutionRecord,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  /* istanbul ignore next */
  const { prefix, body, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/executions/${body.arn}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  });
};

/**
 * DELETE /executions/{executionArn}
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.executionArn - the execution ARN
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - the response from the callback
 */
export const deleteExecution = async (params: {
  prefix: string,
  executionArn: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  /* istanbul ignore next */
  const { prefix, executionArn, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/executions/${executionArn}`,
    },
  });
};

/**
 * Search executions by granules
 * POST /executions/search-by-granules
 * @param {Object} params             - params
 * @param {Object} params.body       - body to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const searchExecutionsByGranules = async (params: {
  prefix: string,
  payload: object,
  query?: {
    [key: string]: string | string[] | undefined
  },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  /* istanbul ignore next */
  const { query, prefix, payload, callback = invokeApi } = params;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/executions/search-by-granules',
      queryStringParameters: query,
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: [200],
  });
};

/**
 * Gets common workflows for a set of granules
 * POST /executions/workflows-by-granules
 * @param {Object} params             - params
 * @param {Object} params.body       - body to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const workflowsByGranules = async (params: {
  prefix: string,
  payload: object,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  /* istanbul ignore next */
  const { prefix, payload, callback = invokeApi } = params;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/executions/workflows-by-granules',
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: 202,
  });
};

/**
 *
 * POST /executions/workflows-by-granules
 * @param {Object} params             - params
 * @param {Object} params.body       - body to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const bulkDeleteByCollection = async (params: {
  prefix: string,
  payload: object,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  /* istanbul ignore next */
  const { prefix, payload, callback = invokeApi } = params;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/executions/bulk-delete-by-collection/',
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: 202,
  });
};
