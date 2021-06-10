'use strict';

const pRetry = require('p-retry');

function setDistributionApiEnvVars() {
  process.env.PORT = 5002;
  process.env.DISTRIBUTION_REDIRECT_ENDPOINT = `http://localhost:${process.env.PORT}/redirect`;
  process.env.DISTRIBUTION_ENDPOINT = `http://localhost:${process.env.PORT}`;
  // Ensure integration tests use Earthdata login UAT if not specified.
  if (!process.env.EARTHDATA_BASE_URL) {
    process.env.EARTHDATA_BASE_URL = 'https://uat.urs.earthdata.nasa.gov';
  }
}

async function waitForApiStatus(getMethod, params, status, config) {
  return await pRetry(
    async () => {
      const record = await getMethod(params);

      if (record.status !== status) {
        throw new Error(`Record status ${record.status}. Expect status ${status}`);
      }
      return record;
    },
    {
      maxTimeout: 60 * 1000,
      ...config,
    }
  );
}

/**
 * Check a record for a particular set of statuses and retry until the record gets that status
 * This is to mitigate issues where a workflow completes, but there is a lag between
 * the workflow end, cloudwatch event sqs message, and database update
 *
 * @param {Object} model - model from api/models
 * @param {Object} params - params to pass to model.get
 * @param {string[] | string} status - status to wait for
 */
async function waitForModelStatus(model, params, status) {
  return await pRetry(
    async () => {
      const record = await model.get(params);
      const checkStatus = [status].flat();
      if (!checkStatus.includes(record.status)) {
        throw new Error(`Record status ${record.status}. Expect status ${checkStatus}`);
      }

      return record;
    },
    {
      maxTimeout: 60 * 1000,
    }
  );
}

module.exports = {
  setDistributionApiEnvVars,
  waitForModelStatus,
  waitForApiStatus,
};
