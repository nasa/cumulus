'use strict';

const cloneDeep = require('lodash.clonedeep');
const {
  aws: { lambda }
} = require('@cumulus/common');
const {
  models: { AccessToken, User },
  testUtils: { fakeAccessTokenFactory, fakeUserFactory },
  tokenUtils: { createJwtToken }
} = require('@cumulus/api');

/**
 * Call the Cumulus API by invoking the Lambda function that backs the API
 * Gateway endpoint.
 *
 * Intended for use with integration tests.  Will invoke the function in AWS
 * Lambda.  This function will handle authorization of the request.
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.functionName - the name of the Lambda function that
 *   backs the API Gateway endpoint.  Does not include the stack prefix in the
 *   name.
 * @param {string} params.payload - the payload to send to the Lambda function.
 *   See https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @returns {Promise<Object>} - the parsed payload of the response.  See
 *   https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-output-format
 */
async function callCumulusApi({ prefix, functionName, payload: userPayload }) {
  const payload = cloneDeep(userPayload);

  process.env.UsersTable = `${prefix}-UsersTable`;
  const userModel = new User();

  const { userName } = await userModel.create(fakeUserFactory());

  process.env.AccessTokensTable = `${prefix}-AccessTokensTable`;
  const accessTokenModel = new AccessToken();

  const {
    accessToken,
    refreshToken,
    expirationTime
  } = fakeAccessTokenFactory();
  await accessTokenModel.create({ accessToken, refreshToken });

  const jwtAuthToken = createJwtToken({ accessToken, username: userName, expirationTime });

  // Add authorization header to the request
  payload.headers = payload.headers || {};
  payload.headers.Authorization = `Bearer ${jwtAuthToken}`;

  let apiOutput;
  try {
    apiOutput = await lambda().invoke({
      Payload: JSON.stringify(payload),
      FunctionName: `${prefix}-${functionName}`
    }).promise();
  }
  finally {
    // Delete the user created for this request
    await userModel.delete(userName);
    await accessTokenModel.delete({ accessToken });
  }

  return JSON.parse(apiOutput.Payload);
}

/**
 * Check API Lambda response for errors.
 *
 * Invoking Lambda directly will return 200 as long as the Lambda execution
 * itself did not fail, ignoring any HTTP response codes internal to the
 * object returned by the execution. Manually check those codes so we can
 * throw any encountered errors.
 *
 * @param {Object} response - the parsed payload of the API response
 * @param {Array<number>} acceptedCodes - additional HTTP status codes to consider successful
 * @throws {Error} - error from the API response
 * @returns {Object} - the original response
 */
function verifyCumulusApiResponse(response, acceptedCodes = []) {
  const successCodes = [200].concat(acceptedCodes);
  if (!successCodes.includes(response.statusCode)) {
    throw new Error(response.body);
  }
  return response;
}

/**
 * GET /asyncOperations/{id}
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.id - an AsyncOperation id
 * @returns {Promise<Object>} - the AsyncOperation fetched by the API
 */
async function getAsyncOperation({ prefix, id }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiAsyncOperationsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/asyncOperations/{id}',
      path: `/asyncOperations/${id}`,
      pathParameters: { id }
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * POST /bulkDelete
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleIds - the granules to be deleted
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function postBulkDelete({ prefix, granuleIds }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiBulkDeleteDefault',
    payload: {
      httpMethod: 'POST',
      resource: '/bulkDelete',
      path: '/bulkDelete',
      pathParameters: {},
      body: JSON.stringify({ granuleIds })
    }
  });
  return verifyCumulusApiResponse(response, [202]);
}

/**
 * Delete a pdr from Cumulus via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.pdr - a pdr name
 * @returns {Promise<Object>} - the delete confirmation from the API
 */
async function deletePdr({ prefix, pdr }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiPdrsDefault',
    payload: {
      httpMethod: 'DELETE',
      resource: '/pdrs/{pdrName}',
      path: `/pdrs/${pdr}`,
      pathParameters: {
        pdrName: pdr
      }
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Fetch logs from the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - the logs fetched by the API
 */
async function getLogs({ prefix }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiLogsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/logs',
      path: 'logs',
      pathParameters: {}
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Fetch logs from an execution from the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.executionName - execution name
 * @returns {Promise<Object>} - the logs fetched by the API
 */
async function getExecutionLogs({ prefix, executionName }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiLogsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/logs/{executionName}',
      path: `logs/${executionName}`,
      pathParameters: {
        executionName: executionName
      }
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Add a collection to Cumulus via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Object} params.collection - a collection object
 * @returns {Promise<Object>} - the POST confirmation from the API
 */
async function addCollectionApi({ prefix, collection }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiCollectionsDefault',
    payload: {
      httpMethod: 'POST',
      resource: '/collections',
      path: '/collections',
      body: JSON.stringify(collection)
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Add a provider to Cumulus via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Object} params.provider - a provider object
 * @returns {Promise<Object>} - the POST confirmation from the API
 */
async function addProviderApi({ prefix, provider }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiProvidersDefault',
    payload: {
      httpMethod: 'POST',
      resource: '/providers',
      path: '/providers',
      body: JSON.stringify(provider)
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Fetch a list of providers from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - the list of providers fetched by the API
 */
async function getProviders({ prefix }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiProvidersDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/providers',
      path: '/providers'
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Fetch a provider from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.providerId - the ID of the provider to fetch
 * @returns {Promise<Object>} - the provider fetched by the API
 */
async function getProvider({ prefix, providerId }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiProvidersDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/providers/{providerId}',
      path: `/providers/${providerId}`,
      pathParameters: {
        id: providerId
      }
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Fetch a list of collections from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - the list of collections fetched by the API
 */
async function getCollections({ prefix }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiCollectionsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/collections',
      path: '/collections'
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Fetch a collection from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.collectionId - the ID of the collection to fetch
 * @param {string} params.collectionVersion - the version of the collection to fetch
 * @returns {Promise<Object>} - the collection fetched by the API
 */
async function getCollection({ prefix, collectionName, collectionVersion }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiCollectionsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/collections/{collectionName}/{version}',
      path: `/collections/${collectionName}/${collectionVersion}`,
      pathParameters: {
        collectionName: collectionName,
        version: collectionVersion
      }
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Fetch a list of workflows from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - the list of workflows fetched by the API
 */
async function getWorkflows({ prefix }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiWorkflowsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/workflows',
      path: '/workflows'
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Fetch a  workflow from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.workflowName - name of the workflow to be fetched
 * @returns {Promise<Object>} - the workflow fetched by the API
 */
async function getWorkflow({ prefix, workflowName }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiWorkflowsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/workflows/name',
      path: `/workflows/${workflowName}`,
      pathParameters: {
        name: workflowName
      }
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Update a collection in Cumulus via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Object} params.collection - the collection object
 * @param {string} params.collection.name - the collection name (required)
 * @param {string} params.collection.version - the collection version (required)
 * @param {Object} params.updateParams - key/value to update on the collection
 * @returns {Promise<Object>} - the updated collection from the API
 */
async function updateCollection({ prefix, collection, updateParams }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiCollectionsDefault',
    payload: {
      httpMethod: 'PUT',
      resource: '/collections',
      path: '/collections',
      body: JSON.stringify(Object.assign(collection, updateParams)),
      pathParameters: {
        collectionName: collection.name,
        version: collection.version
      }
    }
  });
  return verifyCumulusApiResponse(response);
}

/**
 * Update a provider in Cumulus via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Object} params.collection - the provider object
 * @param {string} params.collection.id - the provider id (required)
 * @param {Object} params.updateParams - key/value to update on the provider
 * @returns {Promise<Object>} - the updated provider from the API
 */
async function updateProvider({ prefix, provider, updateParams }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiProvidersDefault',
    payload: {
      httpMethod: 'PUT',
      resource: '/providers',
      path: '/providers',
      body: JSON.stringify(Object.assign(provider, updateParams)),
      pathParameters: {
        id: provider.id
      }
    }
  });
  return verifyCumulusApiResponse(response);
}

module.exports = {
  callCumulusApi,
  getAsyncOperation,
  deletePdr,
  getExecutionLogs,
  addCollectionApi,
  addProviderApi,
  getProviders,
  getCollections,
  getWorkflows,
  getWorkflow,
  getProvider,
  getCollection,
  getLogs,
  postBulkDelete,
  updateCollection,
  updateProvider
};
