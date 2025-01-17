//@ts-check

'use strict';

/**
 * This lambda has a dummy handler because it needs to be rewritten for PG instead of running
 * in ElasticSearch. This will be done in CUMULUS-3982.
 * When this is being rewritten, redo the test file also.
 */

const Logger = require('@cumulus/logger');
const log = new Logger({
  sender: '@cumulus/api/lambdas/cleanExecutions',
});

/**
 * parse out environment variable configuration
 * @returns {{
 *   cleanupNonRunning: boolean,
 *   cleanupRunning: boolean,
 *   payloadTimeout: number
 *   esIndex: string,
 *   updateLimit: number,
 * }}
 */
const parseEnvironment = () => {
  const cleanupNonRunning = JSON.parse(process.env.CLEANUP_NON_RUNNING || 'true');
  const cleanupRunning = JSON.parse(process.env.CLEANUP_RUNNING || 'false');
  if (!cleanupRunning && !cleanupNonRunning) throw new Error('running and non-running executions configured to be skipped, nothing to do');

  const _payloadTimeout = process.env.PAYLOAD_TIMEOUT || '10';
  const payloadTimeout = Number.parseInt(_payloadTimeout, 10);
  if (!Number.isInteger(payloadTimeout)) {
    throw new TypeError(`Invalid number of days specified in configuration for payloadTimeout: ${_payloadTimeout}`);
  }
  const esIndex = process.env.ES_INDEX || 'cumulus';

  const updateLimit = Number(process.env.UPDATE_LIMIT || 10000);
  return {
    cleanupRunning,
    cleanupNonRunning,
    payloadTimeout,
    esIndex,
    updateLimit,
  };
};

async function handler(_event) {
  const envConfig = parseEnvironment();
  log.info(`running empty (to be updated) cleanExecutions with configuration ${JSON.stringify(envConfig)}`);
}

if (require.main === module) {
  handler(
  ).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}

module.exports = {
  handler,
};
