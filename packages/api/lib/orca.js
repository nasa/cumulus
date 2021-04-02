'use strict';

const cloneDeep = require('lodash/cloneDeep');
const { listRequests } = require('@cumulus/api-client/orca');

const Logger = require('@cumulus/logger');
const log = new Logger({ sender: 'api/lib/orca' });

/**
 * get recovery status for a given granule
 * TODO current orca api returns recovery status for each file, update to
 * use granule recovery status when available
 *
 * @param {string} granuleId - granule id
 * @returns {string} - granule recovery status
 * valid values: null (no recovery status found), completed, failed, running
 */
const getOrcaRecoveryStatusByGranuleId = async (granuleId) => {
  let response;
  try {
    response = await listRequests({
      prefix: process.env.stackName,
      query: { granuleId },
    });
  } catch (error) {
    log.error('Unable to get orca recovery status');
    log.error(error);
    return undefined;
  }

  const requests = JSON.parse(response.body);
  const jobStatuses = requests.map((request) => request.job_status);

  let recoveryStatus = 'failed';
  if (jobStatuses.length === 0) {
    recoveryStatus = undefined;
  } else if (jobStatuses.filter((jobStatus) => jobStatus !== 'complete').length === 0) {
    recoveryStatus = 'completed';
  } else if (jobStatuses.filter((jobStatus) => !['complete', 'error'].includes(jobStatus)).length > 0) {
    recoveryStatus = 'running';
  }
  return recoveryStatus;
};

/**
 * add recovery status for each granule in the granule list response
 *
 * @param {Object} inputResponse - an elasticsearch reponse returned from granules query
 * @returns {Object} a copy of input response object where each granule
 *      has been updated to include orca recovery status
 */
const addOrcaRecoveryStatus = async (inputResponse) => {
  const response = cloneDeep(inputResponse);
  const jobs = response.results.map(async (granule) => {
    const recoveryStatus = await getOrcaRecoveryStatusByGranuleId(granule.granuleId);
    return { ...granule, recoveryStatus };
  });
  response.results = await Promise.all(jobs);
  return response;
};

module.exports = {
  addOrcaRecoveryStatus,
  getOrcaRecoveryStatusByGranuleId,
};
