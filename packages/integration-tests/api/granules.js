'use strict';

const { callCumulusApi } = require('./api');

/**
 * GET /granules/{granuleName}
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @returns {Promise<Object>} - the granule fetched by the API
 */
async function getGranule({ prefix, granuleId }) {
  return callCumulusApi({
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
  return callCumulusApi({
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
    return payload;
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
  return callCumulusApi({
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
  return callCumulusApi({
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
}

/**
 * Move a granule via the API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.granuleId - a granule ID
 * @param {Array<Object>} params.destinations - move granule destinations
 * @returns {Promise<Object>} - the move response from the API
 */
async function moveGranule({ prefix, granuleId, destinations }) {
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
      body: JSON.stringify({ action: 'move', destinations })
    }
  });

  try {
    return payload;
  }
  catch (error) {
    console.log(`Error parsing JSON response removing granule ${granuleId} from CMR: ${JSON.stringify(payload)}`);
    throw error;
  }
}

module.exports = {
  getGranule,
  reingestGranule,
  removeFromCMR,
  applyWorkflow,
  deleteGranule,
  moveGranule
};
