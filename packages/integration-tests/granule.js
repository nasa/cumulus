'use strict';

const pWaitFor = require('p-wait-for');
const { getGranule } = require('./api.js');

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
    async () => (await getGranule({
      prefix,
      granuleId
    })).status === status,
    {
      interval,
      timeout
    }
  );
}

module.exports = {
  waitUntilGranuleStatusIs
};
