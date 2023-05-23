import pRetry from 'p-retry';

import { ApiGranuleRecord, GranuleId, GranuleStatus } from '@cumulus/types/api/granules';
import { CollectionId } from '@cumulus/types/api/collections';
import Logger from '@cumulus/logger';

import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

const logger = new Logger({ sender: '@api-client/granules' });

type AssociateExecutionRequest = {
  granuleId: string
  collectionId: string
  executionArn: string
};

/**
 * GET raw response from /granules/{collectionId}/{granuleId}
 *
 * @param {Object} params                                - params
 * @param {string} params.prefix                         - the prefix configured for the stack
 * @param {string} params.granuleId                      - a granule ID
 * @param {string} params.collectionId                   - a collection ID
 * @param {Object} [params.query]                        - query to pass the API lambda
 * @param {number[] | number} params.expectedStatusCodes - the statusCodes which the granule API is
 *                                                         is expecting for the invokeApi Response,
 *                                                         default is 200
 * @param {Function} params.callback                     - async function to invoke the api lambda
 *                                                         that takes a prefix / user payload,
 *                                                         cumulusApiClient.invokeApifunction
 *                                                         is the default to invoke the api lambda
 * @returns {Promise<Object>}                            - the granule fetched by the API
 */
export const getGranuleResponse = async (params: {
  prefix: string,
  granuleId: GranuleId,
  collectionId: CollectionId,
  expectedStatusCodes?: number[] | number,
  query?: { [key: string]: string },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const {
    prefix,
    granuleId,
    collectionId,
    query,
    expectedStatusCodes,
    callback = invokeApi,
  } = params;

  const path = `/granules/${collectionId}/${granuleId}`;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path,
      ...(query && { queryStringParameters: query }),
    },
    expectedStatusCodes,
  });
};

/**
 * GET granule record from /granules/{collectionId}/{granuleId}
 *
 * @param {Object} params               - params
 * @param {string} params.prefix        - the prefix configured for the stack
 * @param {string} params.granuleId     - a granule ID
 * @param {string} params.collectionId  - a collection ID
 * @param {Object} [params.query]       - query to pass the API lambda
 * @param {Function} params.callback    - async function to invoke the api lambda
 *                                        that takes a prefix / user payload.  Defaults
 *                                        to cumulusApiClient.invokeApifunction to invoke the
 *                                        api lambda
 * @returns {Promise<Object>}           - the granule fetched by the API
 */
export const getGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  collectionId: CollectionId,
  query?: { [key: string]: string },
  callback?: InvokeApiFunction
}): Promise<ApiGranuleRecord> => {
  const response = await getGranuleResponse(params);
  return JSON.parse(response.body);
};

/**
 * Wait for a granule to be present in the database (using pRetry)
 *
 * @param {Object} params               - params
 * @param {string} params.granuleId     - granuleId to wait for
 * @param {string} params.collectionId  - collectionId
 * @param {number} params.retries       - number of times to retry
 * @param {Function} params.callback    - async function to invoke the api lambda
 *                                        that takes a prefix / user payload.  Defaults
 *                                        to cumulusApiClient.invokeApifunction to invoke the
 *                                        api lambda
 */
export const waitForGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  collectionId: CollectionId
  status?: GranuleStatus,
  retries?: number,
  pRetryOptions?: pRetry.Options,
  callback?: InvokeApiFunction
}) => {
  const {
    prefix,
    granuleId,
    collectionId,
    status,
    retries = 10,
    pRetryOptions = {},
    callback = invokeApi,
  } = params;

  await pRetry(
    async () => {
      // TODO update to use collectionId + granuleId
      const apiResult = await getGranuleResponse({ prefix, granuleId, collectionId, callback });

      if (apiResult.statusCode === 500) {
        throw new pRetry.AbortError('API misconfigured/down/etc, failing test');
      }

      if (apiResult.statusCode !== 200) {
        throw new Error(`granule ${granuleId} not in database yet, status ${apiResult.statusCode} retrying....`);
      }

      if (status) {
        const granuleStatus = JSON.parse(apiResult.body).status;

        if (status !== granuleStatus) {
          throw new Error(`Granule status ${granuleStatus} does not match requested status, retrying...`);
        }
      }

      logger.info(`Granule ${granuleId} in database, proceeding...`); // TODO fix logging
    },
    {
      retries,
      onFailedAttempt: (e) => {
        logger.error(e.message);
      },
      ...pRetryOptions,
    }
  );
};

/**
 * Reingest a granule from the Cumulus API
 * PATCH /granules/{collectionId}/{granuleId}
 *
 * @param {Object} params               - params
 * @param {string} params.prefix        - the prefix configured for the stack
 * @param {string} params.granuleId     - a granule ID
 * @param {string} params.collectionId  - a collection ID
 * @param {string} params.workflowName  - Optional WorkflowName
 * @param {string} params.executionArn  - Optional executionArn
 * @param {Function} params.callback    - async function to invoke the api lambda
 *                                        that takes a prefix / user payload.  Defaults
 *                                        to cumulusApiClient.invokeApifunction to invoke the
 *                                        api lambda
 * @returns {Promise<Object>}           - the granule fetched by the API
 */
export const reingestGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  collectionId: CollectionId,
  workflowName?: string | undefined,
  executionArn?: string | undefined,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const {
    prefix,
    granuleId,
    collectionId,
    workflowName,
    executionArn,
    callback = invokeApi,
  } = params;

  const path = `/granules/${collectionId}/${granuleId}`;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      path,
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      body: JSON.stringify({
        action: 'reingest',
        workflowName,
        executionArn,
      }),
    },
  });
};

/**
 * Removes a granule from CMR via the Cumulus API
 * PATCH /granules/{collectionId}/{granuleId}
 *
 * @param {Object} params               - params
 * @param {string} params.prefix        - the prefix configured for the stack
 * @param {string} params.granuleId     - a granule ID
 * @param {string} params.collectionId  - a collection ID
 * @param {Function} params.callback    - async function to invoke the api lambda
 *                                        that takes a prefix / user payload.  Defaults
 *                                        to cumulusApiClient.invokeApifunction to invoke the
 *                                        api lambda
 * @returns {Promise<Object>}           - the granule fetched by the API
 */
export const removeFromCMR = async (params: {
  prefix: string,
  granuleId: GranuleId,
  collectionId: CollectionId,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, granuleId, collectionId, callback = invokeApi } = params;

  const path = `/granules/${collectionId}/${granuleId}`;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      path,
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      body: JSON.stringify({ action: 'removeFromCmr' }),
    },
  });
};

/**
 * Run a workflow with the given granule as the payload
 * PATCH /granules/{collectionId}/{granuleId}
 *
 * @param {Object} params               - params
 * @param {string} params.prefix        - the prefix configured for the stack
 * @param {string} params.granuleId     - a granule ID
 * @param {string} params.collectionId  - a collection ID
 * @param {string} params.workflow      - workflow to be run with given granule
 * @param {Function} params.callback    - async function to invoke the api lambda
 *                                        that takes a prefix / user payload.  Defaults
 *                                        to cumulusApiClient.invokeApifunction to invoke the
 *                                        api lambda
 * @returns {Promise<Object>}           - the granule fetched by the API
 */
export const applyWorkflow = async (params: {
  prefix: string,
  granuleId: GranuleId,
  collectionId: CollectionId,
  workflow: string,
  meta?: object,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const {
    prefix,
    granuleId,
    collectionId,
    workflow,
    meta,
    callback = invokeApi,
  } = params;

  const path = `/granules/${collectionId}/${granuleId}`;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      path,
      body: JSON.stringify({ action: 'applyWorkflow', workflow, meta }),
    },
  });
};

/**
 * Delete a granule from Cumulus via the API lambda
 * DELETE /granules/{collectionId}/{granuleId}
 *
 * @param {Object} params                      - params
 * @param {pRetry.Options} params.pRetryObject - pRetry options object
 * @param {string} params.prefix               - the prefix configured for the stack
 * @param {string} params.granuleId            - a granule ID
 * @param {string} params.collectionId         - a collection ID
 * @param {Function} params.callback           - async function to invoke the api lambda
 *                                               that takes a prefix / user payload.  Defaults
 *                                               to cumulusApiClient.invokeApifunction to invoke the
 *                                               api lambda
 * @returns {Promise<Object>}                  - the delete confirmation from the API
 */
export const deleteGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  collectionId: CollectionId,
  pRetryOptions?: pRetry.Options,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const {
    pRetryOptions,
    prefix,
    granuleId,
    collectionId,
    callback = invokeApi,
  } = params;

  const path = `/granules/${collectionId}/${granuleId}`;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path,
    },
    pRetryOptions,
  });
};

/**
 * Move a granule via the API
 * PATCH /granules/{collectionId}/{granuleId}
 *
 * @param {Object} params                       - params
 * @param {string} params.prefix                - the prefix configured for the stack
 * @param {string} params.granuleId             - a granule ID
 * @param {string} params.collectionId         - a collection ID
 * @param {Array<Object>} params.destinations   - move granule destinations
 * @param {Function} params.callback            - async function to invoke the api lambda
 *                                                that takes a prefix / user payload.  Defaults
 *                                                to cumulusApiClient.invokeApifunction to invoke
 *                                                the api lambda
 * @returns {Promise<Object>}                   - the move response from the API
 */
export const moveGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  collectionId: CollectionId,
  destinations: unknown[],
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const {
    prefix,
    granuleId,
    collectionId,
    destinations,
    callback = invokeApi,
  } = params;

  const path = `/granules/${collectionId}/${granuleId}`;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      path,
      body: JSON.stringify({ action: 'move', destinations }),
    },
  });
};

/**
 * Removed a granule from CMR and delete from Cumulus via the API
 *
 * @param {Object} params               - params
 * @param {string} params.prefix        - the prefix configured for the stack
 * @param {string} params.granuleId     - a granule ID
 * @param {string} params.collectionId  - a collection ID
 * @param {Function} params.callback    - async function to invoke the api lambda
 *                                        that takes a prefix / user payload.  Defaults
 *                                        to cumulusApiClient.invokeApifunction to invoke the
 *                                        api lambda
 * @returns {Promise<Object>}           - the delete confirmation from the API
 */
export const removePublishedGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  collectionId: CollectionId,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, granuleId, collectionId, callback = invokeApi } = params;

  // pre-delete: Remove the granule from CMR
  await removeFromCMR({ prefix, granuleId, collectionId, callback });
  return deleteGranule({ prefix, granuleId, collectionId, callback });
};

/**
 * Query  granules stored in cumulus
 * GET /granules
 * @param {Object} params             - params
 * @param {Object} [params.query]       - query to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const listGranules = async (params: {
  prefix: string,
  query?: {
    fields?: string[],
    [key: string]: string | string[] | undefined
  },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, query, callback = invokeApi } = params;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/granules',
      queryStringParameters: query,
    },
  });
};

/**
 * Create granule into cumulus.
 * POST /granules
 * @param {Object} params             - params
 * @param {Object} [params.body]      - granule to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const createGranule = async (params: {
  prefix: string,
  body: ApiGranuleRecord,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, body, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      path: '/granules',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  });
};

/**
 * Update/create granule in cumulus via PUT request.  Existing values will
 * be removed if not specified and in some cases replaced with defaults.
 * Granule execution association history will be retained.
 * PUT /granules/{collectionId}/{granuleId}
 * @param {Object} params             - params
 * @param {Object} [params.body]      - granule to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const replaceGranule = async (params: {
  prefix: string,
  body: ApiGranuleRecord,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, body, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/granules/${body.collectionId}/${body.granuleId}`,
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      body: JSON.stringify(body),
    },
    expectedStatusCodes: [200, 201],
  });
};

/**
 * Update granule in cumulus via PATCH request.  Existing values will
 * not be overwritten if not specified, null values will be removed and in
 * some cases replaced with defaults.
 * PATCH /granules/{collectionId}/{granuleId}
 * @param {Object} params             - params
 * @param {Object} [params.body]      - granule to pass the API lambda
 * @param {string} params.collectionId  - a collection ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const updateGranule = async (params: {
  prefix: string,
  body: ApiGranuleRecord,
  granuleId: GranuleId,
  collectionId: CollectionId,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, granuleId, collectionId, body, callback = invokeApi } = params;

  const path = `/granules/${collectionId}/${granuleId}`;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      path,
      headers: { 'Content-Type': 'application/json', 'Cumulus-API-Version': '2' },
      body: JSON.stringify(body),
    },
    expectedStatusCodes: [200, 201],
  });
};

/**
 * Associate an execution with a granule in cumulus.
 * POST /granules/{granuleId}/execution
 * @param {Object} params             - params
 * @param {Object} [params.body]      - granule and execution info to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const associateExecutionWithGranule = async (params: {
  prefix: string,
  body: AssociateExecutionRequest,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, body, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      path: `/granules/${body.granuleId}/executions`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  });
};

/**
 * Bulk operations on granules stored in cumulus
 * POST /granules/bulk
 * @param {Object} params             - params
 * @param {Object} params.body        - body to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const bulkGranules = async (params: {
  prefix: string,
  body: object,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, body, callback = invokeApi } = params;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/granules/bulk',
      body: JSON.stringify(body),
    },
    expectedStatusCodes: 202,
  });
};

/**
 * Bulk delete granules stored in cumulus
 * POST /granules/bulkDelete
 * @param {Object} params             - params
 * @param {Object} params.body       - body to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const bulkDeleteGranules = async (params: {
  prefix: string,
  body: unknown,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, body, callback = invokeApi } = params;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/granules/bulkDelete',
      body: JSON.stringify(body),
    },
    expectedStatusCodes: 202,
  });
};

export const bulkReingestGranules = async (params: {
  prefix: string,
  body: unknown,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, body, callback = invokeApi } = params;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/granules/bulkReingest',
      body: JSON.stringify(body),
    },
    expectedStatusCodes: 202,
  });
};

/**
 * Bulk Granule Operations
 * POST /granules/bulk
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Array<string>} params.ids - the granules to have bulk operation on
 * @param {string} params.workflowName - workflowName for the bulk operation execution
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const bulkOperation = async (params: {
  prefix: string,
  ids: string[],
  workflowName: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, ids, workflowName, callback = invokeApi } = params;
  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      path: '/granules/bulk/',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids, workflowName }),
    },
    expectedStatusCodes: 202,
  });
};
