'use strict';

const pWaitFor = require('p-wait-for');
const { getGranule } = require('./api/granules');

/**
 * Run getGranule and return expected format
 *
 * @param {*} prefix - the stack name
 * @param {*} granuleId - the Cumulus granule id
 * @returns {Object} - response from getGranule
 */
async function getGranuleResponse(prefix, granuleId) {
  const granuleResponse = await getGranule({ prefix, granuleId });
  return JSON.parse(granuleResponse.body);
}

/**
 * Wait until granule status is desired status
 *
 * @param {string} prefix - the stack name
 * @param {string} granuleId - the Cumulus granule id
 * @param {string} status - the desired granule status
 * @param {number} [timeout=5*60000] - maximum wait time (ms)
 * @returns {undefined} - undefined
 * @throws {TimeoutError} - throws error when timeout is reached
 */
async function waitUntilGranuleStatusIs(prefix, granuleId, status, timeout = (5 * 60000)) {
  const interval = 15 * 1000;

  await pWaitFor(
    async () => (await getGranuleResponse(
      prefix,
      granuleId
    )).status === status,
    {
      interval,
      timeout
    }
  );
}

module.exports = {
  waitUntilGranuleStatusIs
};
