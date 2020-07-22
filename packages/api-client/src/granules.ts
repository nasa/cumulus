import pRetry from 'p-retry';
import Logger from '@cumulus/logger';
import { GranuleId, GranuleStatus } from '@cumulus/types/api/granules';
import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

const logger = new Logger({ sender: '@api-client/granules' });

/**
 * GET /granules/{granuleName}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
export const getGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, granuleId, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/granules/${granuleId}`
    }
  });
};

/**
 * Wait for a granule to be present in the database (using pRetry)
 *
 * @param {Object} params             - params
 * @param {string} params.granuleId   - granuleId to wait for
 * @param {number} params.retries     - number of times to retry
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 */
export const waitForGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  status?: GranuleStatus,
  retries?: number,
  pRetryOptions?: pRetry.Options,
  callback?: InvokeApiFunction
}) => {
  const {
    prefix,
    granuleId,
    status,
    retries = 10,
    pRetryOptions = {},
    callback = invokeApi
  } = params;

  await pRetry(
    async () => {
      const apiResult = await getGranule({ prefix, granuleId, callback });

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
      onFailedAttempt: async (e) => {
        logger.error(e.message);
      },
      ...pRetryOptions
    }
  );
};

/**
 * Reingest a granule from the Cumulus API
 * PUT /granules/{}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
export const reingestGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, granuleId, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/granules/${granuleId}`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'reingest' })
    }
  });
};

/**
 * Removes a granule from CMR via the Cumulus API
 * PUT /granules/{granuleId}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
export const removeFromCMR = async (params: {
  prefix: string,
  granuleId: GranuleId,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, granuleId, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/granules/${granuleId}`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'removeFromCmr' })
    }
  });
};

/**
 * Run a workflow with the given granule as the payload
 * PUT /granules/{granuleId}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {string} params.workflow    - workflow to be run with given granule
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
export const applyWorkflow = async (params: {
  prefix: string,
  granuleId: GranuleId,
  workflow: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const {
    prefix,
    granuleId,
    workflow,
    callback = invokeApi
  } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json'
      },
      path: `/granules/${granuleId}`,
      body: JSON.stringify({ action: 'applyWorkflow', workflow })
    }
  });
};

/**
 * Delete a granule from Cumulus via the API lambda
 * DELETE /granules/${granuleId}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the delete confirmation from the API
 */
export const deleteGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, granuleId, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/granules/${granuleId}`
    }
  });
};

/**
 * Move a granule via the API
 * PUT /granules/{granuleId}
 *
 * @param {Object} params                       - params
 * @param {string} params.prefix                - the prefix configured for the stack
 * @param {string} params.granuleId             - a granule ID
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
  destinations: unknown[],
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const {
    prefix,
    granuleId,
    destinations,
    callback = invokeApi
  } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json'
      },
      path: `/granules/${granuleId}`,
      body: JSON.stringify({ action: 'move', destinations })
    }
  });
};

/**
 * Removed a granule from CMR and delete from Cumulus via the API
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the delete confirmation from the API
 */
export const removePublishedGranule = async (params: {
  prefix: string,
  granuleId: GranuleId,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, granuleId, callback = invokeApi } = params;

  // pre-delete: Remove the granule from CMR
  await removeFromCMR({ prefix, granuleId, callback });
  return deleteGranule({ prefix, granuleId, callback });
};

/**
 * Query  granules stored in cumulus
 * GET /granules
 * @param {Object} params             - params
 * @param {string} [params.query]       - query to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export const listGranules = async (params: {
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
      path: '/granules',
      queryStringParameters: query
    }
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

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json'
      },
      path: '/granules/bulkDelete',
      body: JSON.stringify(body)
    }
  });
};
