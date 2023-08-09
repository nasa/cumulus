'use strict';

const cloneDeep = require('lodash/cloneDeep');
const got = require('got');

const Logger = require('@cumulus/logger');
const log = new Logger({ sender: 'api/lib/orca' });

/**
 * post request to ORCA
 *
 * @param {Object} params
 * @param {string} params.orcaApiUri - orca endpoint url
 * @param {string} params.path - path of the request
 * @param {Object} params.body - body of the request
 * @returns {Promise<Object>} - resolves to the ORCA return
 */
async function postRequestToOrca({ orcaApiUri = process.env.orca_api_uri, path, body }) {
  if (!orcaApiUri) {
    const errMsg = 'The orca_api_uri environment variable is not set';
    log.error(errMsg);
    throw new Error(errMsg);
  }

  try {
    return await got.post(
      `${orcaApiUri}/${path}`,
      {
        json: body || {},
        responseType: 'json',
        throwHttpErrors: false,
      }
    );
  } catch (error) {
    log.error('postRequestToOrca encountered error:', error);
    throw error;
  }
}

/**
 * get recovery status for a given granule
 * TODO current orca api returns recovery status for each file, update to
 * use granule recovery status when available
 *
 * @param {string} granuleId - granule id
 * @param {string} collectionId - collection id
 * @returns {string} - granule recovery status
 * valid values: null (no recovery status found), completed, failed, running
 */
const getOrcaRecoveryStatusByGranuleIdAndCollection = async (granuleId, collectionId) => {
  let response;
  try {
    response = await postRequestToOrca({
      path: 'recovery/granules',
      body: { granuleId, collectionId },
    });
  } catch (error) {
    log.error('Unable to get orca recovery status');
    log.error(error);
    return undefined;
  }

  const { statusCode, body } = response;
  if (statusCode !== 200) {
    log.error(`Unable to get orca recovery status for ${granuleId}, ORCA api returned ${statusCode}: ${JSON.stringify(body)}`);
    return undefined;
  }

  const jobStatuses = (body.files || []).map((file) => file.status);
  // file status may be 'pending', 'staged', 'success', or 'failed'
  let recoveryStatus = 'failed';
  if (jobStatuses.length === 0) {
    recoveryStatus = undefined;
  } else if (jobStatuses.filter((jobStatus) => jobStatus !== 'success').length === 0) {
    recoveryStatus = 'completed';
  } else if (jobStatuses.filter((jobStatus) => !['success', 'failed'].includes(jobStatus)).length > 0) {
    recoveryStatus = 'running';
  }
  return recoveryStatus;
};

/**
 * add recovery status for each granule in the granule list response
 *
 * @param {Object} inputResponse - an elasticsearch response returned from granules query
 * @returns {Object} a copy of input response object where each granule
 *      has been updated to include orca recovery status
 */
const addOrcaRecoveryStatus = async (inputResponse) => {
  const response = cloneDeep(inputResponse);
  const jobs = response.results.map(async (granule) => {
    const recoveryStatus = await getOrcaRecoveryStatusByGranuleIdAndCollection(
      granule.granuleId,
      granule.collectionId
    );
    return { ...granule, recoveryStatus };
  });
  response.results = await Promise.all(jobs);
  return response;
};

module.exports = {
  addOrcaRecoveryStatus,
  getOrcaRecoveryStatusByGranuleIdAndCollection,
  postRequestToOrca,
};
