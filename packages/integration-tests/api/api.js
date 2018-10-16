'use strict';

const cloneDeep = require('lodash.clonedeep');
const {
  aws: { lambda }
} = require('@cumulus/common');
const {
  models: { User },
  testUtils: { fakeUserFactory }
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

  const { userName, password } = await userModel.create(fakeUserFactory());

  // Add authorization header to the request
  payload.headers = payload.headers || {};
  payload.headers.Authorization = `Bearer ${password}`;

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
  }

  return JSON.parse(apiOutput.Payload);
}

/**
 * GET /granules/{granuleName}
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function getGranule({ prefix, granuleId }) {
  const response = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiGranulesDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/granules/{granuleName}',
      path: `/granules/${granuleId}`,
      pathParameters: {
        granuleName: granuleId
      }
    }
  });

  return JSON.parse(response.body);
}

/**
 * GET /asyncOperations/{id}
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.id - an AsyncOperation id
 * @returns {Promise<Object>} - the AsyncOperation fetched by the API
 */
function getAsyncOperation({ prefix, id }) {
  return callCumulusApi({
    prefix: prefix,
    functionName: 'ApiAsyncOperationsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/asyncOperations/{id}',
      path: `/asyncOperations/${id}`,
      pathParameters: { id }
    }
  });
}

/**
 * POST /bulkDelete
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleIds - the granules to be deleted
 * @returns {Promise<Object>} - the granule fetched by the API
 */
function postBulkDelete({ prefix, granuleIds }) {
  return callCumulusApi({
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
}

/**
 * Reingest a granule from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function reingestGranule({ prefix, granuleId }) {
  const payload = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiGranulesDefault',
    payload: {
      httpMethod: 'PUT',
      resource: '/granules/{granuleName}',
      path: `/granules/${granuleId}`,
      pathParameters: {
        granuleName: granuleId
      },
      body: JSON.stringify({ action: 'reingest' })
    }
  });

  return JSON.parse(payload.body);
}

/**
 * Removes a granule from CMR via the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function removeFromCMR({ prefix, granuleId }) {
  const payload = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiGranulesDefault',
    payload: {
      httpMethod: 'PUT',
      resource: '/granules/{granuleName}',
      path: `/granules/${granuleId}`,
      pathParameters: {
        granuleName: granuleId
      },
      body: JSON.stringify({ action: 'removeFromCmr' })
    }
  });

  try {
    return JSON.parse(payload.body);
  }
  catch (error) {
    console.log(`Error parsing JSON response removing granule ${granuleId} from CMR: ${JSON.stringify(payload)}`);
    throw error;
  }
}
/**
 * Run a workflow with the given granule as the payload
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @param {string} params.workflow - workflow to be run with given granule
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function applyWorkflow({ prefix, granuleId, workflow }) {
  const payload = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiGranulesDefault',
    payload: {
      httpMethod: 'PUT',
      resource: '/granules/{granuleName}',
      path: `/granules/${granuleId}`,
      pathParameters: {
        granuleName: granuleId
      },
      body: JSON.stringify({ action: 'applyWorkflow', workflow })
    }
  });

  return JSON.parse(payload.body);
}

/**
 * Delete a granule from Cumulus via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @returns {Promise<Object>} - the delete confirmation from the API
 */
async function deleteGranule({ prefix, granuleId }) {
  const payload = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiGranulesDefault',
    payload: {
      httpMethod: 'DELETE',
      resource: '/granules/{granuleName}',
      path: `/granules/${granuleId}`,
      pathParameters: {
        granuleName: granuleId
      }
    }
  });

  return payload;
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
  const payload = await callCumulusApi({
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

  return payload;
}

/**
 * Fetch an execution from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.arn - an execution arn
 * @returns {Promise<Object>} - the execution fetched by the API
 */
async function getExecution({ prefix, arn }) {
  const payload = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiExecutionsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/executions/{arn}',
      path: `executions/${arn}`,
      pathParameters: {
        arn: arn
      }
    }
  });

  return JSON.parse(payload.body);
}

/**
 * Fetch logs from the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - the logs fetched by the API
 */
async function getLogs({ prefix }) {
  const payload = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiLogsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/logs',
      path: 'logs',
      pathParameters: {}
    }
  });

  return JSON.parse(payload.body);
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
  const payload = await callCumulusApi({
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

  return JSON.parse(payload.body);
}

/**
 * get execution status from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.arn - an execution arn
 * @returns {Promise<Object>} - the execution status fetched by the API
 */
async function getExecutionStatus({ prefix, arn }) {
  const payload = await callCumulusApi({
    prefix: prefix,
    functionName: 'ApiExecutionStatusDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/executions/status/{arn}',
      path: `executions/status/${arn}`,
      pathParameters: {
        arn: arn
      }
    }
  });

  return JSON.parse(payload.body);
}

module.exports = {
  applyWorkflow,
  callCumulusApi,
  getAsyncOperation,
  deleteGranule,
  deletePdr,
  getExecution,
  getExecutionLogs,
  getExecutionStatus,
  getGranule,
  getLogs,
  postBulkDelete,
  reingestGranule,
  removeFromCMR
};
