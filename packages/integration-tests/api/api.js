'use strict';

const { invokeApi } = require('@cumulus/api-client/cumulusApiClient');
const { deprecate } = require('@cumulus/common/util');

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
    const errorText = response.body ? response.body : response.errorMessage;
    throw new Error(errorText);
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
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/asyncOperations/${id}`,
    },
  });
  return verifyCumulusApiResponse(response);
}

/**
 * POST /bulkDelete
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Array<string>} params.granuleIds - the granules to be deleted
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function postBulkDelete({ prefix, granuleIds }) {
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      path: '/bulkDelete/',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ granuleIds }),
    },
  });
  return verifyCumulusApiResponse(response, [202]);
}

/**
 * POST /bulk
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Array<string>} params.ids - the granules to have bulk operation on
 * @param {string} params.workflowName - workflowName for the bulk operation execution
 * @returns {Promise<Object>} - the bulk operation response
 */
async function postBulk({ prefix, ids, workflowName }) {
  const response = await invokeApi({
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
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/pdrs/${pdr}`,
    },
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
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/logs',
    },
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
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/logs/${executionName}`,
    },
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
  deprecate('@cumulus/integration-tests/addProviderApi',
    '1.21.0', '@cumulus/api-client/providers.createProvider');
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      path: '/providers/',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(provider),
    },
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
  deprecate('@cumulus/integration-tests/getProviders',
    '1.21.0', '@cumulus/api-client/providers.getProviders');
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/providers',
    },
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
  deprecate('@cumulus/integration-tests/getProvider',
    '1.21.0', '@cumulus/api-client/providers.getProvider');
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/providers/${providerId}`,
    },
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
  deprecate('@cumulus/integration-tests/getCollections',
    '1.21.0', '@cumulus/api-client/collections.getCollections');
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/collections',
    },
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
  deprecate('@cumulus/integration-tests/getCollection',
    '1.21.0', '@cumulus/api-client/collections.getCollection');
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/collections/${collectionName}/${collectionVersion}`,
    },
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
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/workflows',
    },
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
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/workflows/${workflowName}`,
    },
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
  const originalCollection = JSON.parse((await getCollection({
    prefix,
    collectionName: collection.name,
    collectionVersion: collection.version,
  })).body);

  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/collections/${collection.name}/${collection.version}`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...originalCollection,
        ...updateParams,
      }),
    },
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
  const response = await invokeApi({
    prefix: prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      path: `/providers/${provider.id}`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(Object.assign(provider, updateParams)),
    },
  });
  return verifyCumulusApiResponse(response);
}

module.exports = {
  invokeApi,
  getAsyncOperation,
  deletePdr,
  getExecutionLogs,
  addProviderApi,
  getProviders,
  getCollections,
  getWorkflows,
  getWorkflow,
  getProvider,
  getCollection,
  getLogs,
  postBulk,
  postBulkDelete,
  updateCollection,
  updateProvider,
};
