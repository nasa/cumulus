//@ts-check

'use strict';

/**
 * This lambda has been commented out because it needs to be rewritten for PG instead of running
 * in ElasticSearch. This will be done in CUMULUS-XXXX
 */

// const { getEsClient, esConfig } = require('@cumulus/es-client/search');
// const moment = require('moment');
const Logger = require('@cumulus/logger');
// const { sleep } = require('@cumulus/common');
const log = new Logger({
  sender: '@cumulus/api/lambdas/cleanExecutions',
});

// /**
//  * @typedef {import('@cumulus/db').PostgresExecutionRecord} PostgresExecutionRecord
//  * @typedef {import('knex').Knex} Knex
//  */

// /**
//  * Extract expiration dates and identify greater and lesser bounds
//  *
//  * @param {number} payloadTimeout - Maximum number of days a record should be held onto
//  * @returns {Date}
//  */
// const getExpirationDate = (
//   payloadTimeout
// ) => moment().subtract(payloadTimeout, 'days').toDate();

// /**
//  * Clean up Elasticsearch executions that have expired
//  *
//  * @param {number} payloadTimeout - Maximum number of days a record should be held onto
//  * @param {boolean} cleanupRunning - Enable removal of running execution
//  *   payloads
//  * @param {boolean} cleanupNonRunning - Enable removal of execution payloads for
//  *   statuses other than 'running'
//  * @param {number} updateLimit - maximum number of records to update
//  * @param {string} index - Elasticsearch index to cleanup
//  * @returns {Promise<void>}
// */
// const cleanupExpiredESExecutionPayloads = async (
//   payloadTimeout,
//   cleanupRunning,
//   cleanupNonRunning,
//   updateLimit,
//   index
// ) => {
//   const _expiration = getExpirationDate(payloadTimeout);
//   const expiration = _expiration.getTime();

//   const must = [
//     { range: { updatedAt: { lte: expiration } } },
//     {
//       bool: {
//         should: [
//           { exists: { field: 'finalPayload' } },
//           { exists: { field: 'originalPayload' } },
//         ],
//       },
//     },
//   ];
//   const mustNot = [];

//   if (cleanupRunning && !cleanupNonRunning) {
//     must.push({ term: { status: 'running' } });
//   } else if (!cleanupRunning && cleanupNonRunning) {
//     mustNot.push({ term: { status: 'running' } });
//   }
//   const removePayloadScript = "ctx._source.remove('finalPayload'); ctx._source.remove('originalPayload')";

//   const script = { inline: removePayloadScript };
//   const body = {
//     query: {
//       bool: {
//         must,
//         mustNot,
//       },
//     },
//     script: script,
//   };
//   const esClient = await getEsClient();
//   const [{ node }] = await esConfig();
//   // this launches the job for ES to perform, asynchronously
//   const updateTask = await esClient._client.updateByQuery({
//     index,
//     type: 'execution',
//     size: updateLimit,
//     body,
//     conflicts: 'proceed',
//     wait_for_completion: false,
//     refresh: true,
//   });
//   let taskStatus;
//   // this async and poll method allows us to avoid http timeouts
//   // and persist in case of lambda timeout
//   log.info(`launched async elasticsearch task id ${updateTask.body.task}
//   to check on this task outside this lambda, or to stop this task run the following`);
//   log.info(` > curl --request GET ${node}/_tasks/${updateTask.body.task}`);
//   log.info(` > curl --request POST ${node}/_tasks/${updateTask.body.task}/_cancel`);
//   do {
//     sleep(10000);
//     // eslint-disable-next-line no-await-in-loop
//     taskStatus = await esClient._client?.tasks.get({ task_id: updateTask.body.task });
//   } while (taskStatus?.body.completed === false);
//   log.info(`elasticsearch task completed with status ${JSON.stringify(taskStatus?.body.task.status)}`);
// };
// /**
//  * parse out environment variable configuration
//  * @returns {{
//  *   cleanupNonRunning: boolean,
//  *   cleanupRunning: boolean,
//  *   payloadTimeout: number
//  *   esIndex: string,
//  *   updateLimit: number,
//  * }}
//  */
// const parseEnvironment = () => {
//   const cleanupNonRunning = JSON.parse(process.env.CLEANUP_NON_RUNNING || 'true');
//   const cleanupRunning = JSON.parse(process.env.CLEANUP_RUNNING || 'false');
//   if (!cleanupRunning && !cleanupNonRunning) throw new Error('running and non-running executions configured to be skipped, nothing to do');

//   const _payloadTimeout = process.env.PAYLOAD_TIMEOUT || '10';
//   const payloadTimeout = Number.parseInt(_payloadTimeout, 10);
//   if (!Number.isInteger(payloadTimeout)) {
//     throw new TypeError(`Invalid number of days specified in configuration for payloadTimeout: ${_payloadTimeout}`);
//   }
//   const esIndex = process.env.ES_INDEX || 'cumulus';

//   const updateLimit = Number(process.env.UPDATE_LIMIT || 10000);
//   return {
//     cleanupRunning,
//     cleanupNonRunning,
//     payloadTimeout,
//     esIndex,
//     updateLimit,
//   };
// };

/**
 * parse environment variables to extract configuration and run cleanup of ES executions
 *
 * @returns {Promise<void>}
 */
async function cleanExecutionPayloads() {
  const envConfig = parseEnvironment();
  // log.info(`running cleanExecutions with configuration ${JSON.stringify(envConfig)}`);
  // const {
  //   updateLimit,
  //   cleanupRunning,
  //   cleanupNonRunning,
  //   payloadTimeout,
  //   esIndex,
  // } = envConfig;

  // await cleanupExpiredESExecutionPayloads(
  //   payloadTimeout,
  //   cleanupRunning,
  //   cleanupNonRunning,
  //   updateLimit,
  //   esIndex
  // );
  log.info(`running empty (to be updated) cleanExecutions with configuration ${JSON.stringify(envConfig)}`);
}

async function handler(_event) {
  return await cleanExecutionPayloads();
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
  // cleanExecutionPayloads,
  // getExpirationDate,
  // cleanupExpiredESExecutionPayloads,
};
