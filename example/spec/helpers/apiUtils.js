'use strict';

const isMatch = require('lodash/isMatch');
const isNil = require('lodash/isNil');
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

async function waitForApiRecord(getMethod, params, matchParams, retryConfig = {}) {
  return await pRetry(
    async () => {
      if (isNil(matchParams)) {
        throw new pRetry.AbortError('matchParams are required');
      }

      const record = await getMethod(params);

      if (!isMatch(record, matchParams)) {
        throw new Error(`Record ${JSON.stringify(record)} did not match expected ${JSON.stringify(matchParams)}`);
      }

      return record;
    },
    {
      maxTimeout: 60 * 1000,
      ...retryConfig,
    }
  );
}

async function waitForApiStatus(getMethod, params, status, retryConfig = {}) {
  return await pRetry(
    async () => {
      const record = await getMethod(params);

      const checkStatus = [status].flat();
      if (!checkStatus.includes(record.status)) {
        throw new Error(`Record status ${record.status}. Expect status ${status}`);
      }
      return record;
    },
    {
      maxTimeout: 60 * 1000,
      ...retryConfig,
    }
  );
}

module.exports = {
  setDistributionApiEnvVars,
  waitForApiRecord,
  waitForApiStatus,
};
