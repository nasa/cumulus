//@ts-check

'use strict';

const { ExecutionPgModel, getKnexClient } = require('@cumulus/db');
const { getEsClient } = require('@cumulus/es-client/search');
const moment = require('moment');
const Logger = require('@cumulus/logger');
const { sleep } = require('@cumulus/common');
const log = new Logger({
  sender: '@cumulus/api/lambdas/cleanExecutions',
});

/**
 * @typedef {import('@cumulus/db').PostgresExecutionRecord} PostgresExecutionRecord
 * @typedef {import('knex').Knex} Knex
 */

/**
 * Extract expiration dates and identify greater and lesser bounds
 *
 * @param {number} payloadTimeout - Maximum number of days a record should be held onto
 * @returns {Date}
 */
const getExpirationDate = (
  payloadTimeout
) => moment().subtract(payloadTimeout, 'days').toDate();

/**
 * Clean up Elasticsearch executions that have expired
 *
 * @param {number} payloadTimeout - Maximum number of days a record should be held onto
 * @param {boolean} cleanupRunning - Enable removal of running execution
 *   payloads
 * @param {boolean} cleanupNonRunning - Enable removal of execution payloads for
 *   statuses other than 'running'
 * @param {number} updateLimit - maximum number of records to update
 * @param {string} index - Elasticsearch index to cleanup
 * @returns {Promise<void>}
*/
const cleanupExpiredESExecutionPayloads = async (
  payloadTimeout,
  cleanupRunning,
  cleanupNonRunning,
  updateLimit,
  index
) => {
  const _expiration = getExpirationDate(payloadTimeout);
  const expiration = _expiration.getTime();

  const must = [
    { range: { updatedAt: { lte: expiration } } },
    {
      bool: {
        should: [
          { exists: { field: 'finalPayload' } },
          { exists: { field: 'originalPayload' } },
        ],
      },
    },
  ];
  const mustNot = [];

  if (cleanupRunning && !cleanupNonRunning) {
    must.push({ term: { status: 'running' } });
  } else if (!cleanupRunning && cleanupNonRunning) {
    mustNot.push({ term: { status: 'running' } });
  }
  const removePayloadScript = "ctx._source.remove('finalPayload'); ctx._source.remove('originalPayload')";

  const script = { inline: removePayloadScript };
  const body = {
    query: {
      bool: {
        must,
        mustNot,
      },
    },
    script: script,
  };
  const esClient = await getEsClient();
  // this launches the job for ES to perform, asynchronously
  const updateTask = await esClient._client.updateByQuery({
    index,
    type: 'execution',
    size: updateLimit,
    body,
    conflicts: 'proceed',
    wait_for_completion: false,
    refresh: true,
  });
  let taskStatus;
  // this async and poll method allows us to avoid http timeouts
  // and persist in case of lambda timeout
  log.info(`launched async ES task id ${updateTask.body.task}`);
  do {
    sleep(10000);
    // eslint-disable-next-line no-await-in-loop
    taskStatus = await esClient._client?.tasks.get({ task_id: updateTask.body.task });
  } while (taskStatus?.body.completed === false);
  log.info(`es request completed with status ${JSON.stringify(taskStatus?.body.task.status)}`);
};

/**
 * Clean up PG executions that have expired
 *
 * @param {number} payloadTimeout - Maximum number of days a completed
 *   record may have payload entries
 * @param {boolean} cleanupRunning - Enable removal of running execution
 *   payloads
 * @param {boolean} cleanupNonRunning - Enable removal of non-running execution
 *   payloads
 * @returns {Promise<void>}
*/
const cleanupExpiredPGExecutionPayloads = async (
  payloadTimeout,
  cleanupRunning,
  cleanupNonRunning,
  updateLimit
) => {
  const expiration = getExpirationDate(payloadTimeout);
  const knex = await getKnexClient();
  let cleanupOnlyRunning = false;
  let cleanupOnlyNonRunning = false;
  if (cleanupRunning && !cleanupNonRunning) cleanupOnlyRunning = true;
  else if (!cleanupRunning && cleanupNonRunning) cleanupOnlyNonRunning = true;
  const wipedPayloads = {
    original_payload: null,
    final_payload: null,
  };
  const executionModel = new ExecutionPgModel();
  const executionIds = await knex(executionModel.tableName)
    .select('cumulus_id')
    .where('updated_at', '<=', expiration)
    .where((builder) => {
      builder.whereNotNull('final_payload')
        .orWhereNotNull('original_payload');
    })
    .modify((queryBuilder) => {
      if (cleanupOnlyRunning) queryBuilder.where('status', '=', 'running');
      else if (cleanupOnlyNonRunning) queryBuilder.where('status', '!=', 'running');
    })
    .limit(updateLimit);

  // this is done as a search:update because postgres doesn't support limited updates
  await knex(executionModel.tableName)
    .whereIn('cumulus_id', executionIds.map((execution) => execution.cumulus_id))
    .update(wipedPayloads);
};

/**
 * parse out environment variable configuration
 * @returns {{
 *   cleanupNonRunning: boolean,
 *   cleanupRunning: boolean,
 *   cleanupPostgres: boolean,
 *   cleanupES: boolean,
 *   payloadTimeout: number
 *   esIndex: string,
 *   updateLimit: number,
 * }}
 */
const parseEnvironment = () => {
  const cleanupNonRunning = JSON.parse(process.env.CLEANUP_NON_RUNNING || 'true');
  const cleanupRunning = JSON.parse(process.env.CLEANUP_RUNNING || 'false');

  const cleanupPostgres = JSON.parse(process.env.CLEANUP_POSTGRES || 'true');
  const cleanupES = JSON.parse(process.env.CLEANUP_ES || 'true');
  if (!cleanupRunning && !cleanupNonRunning) throw new Error('running and non-running executions configured to be skipped, nothing to do');
  if (!cleanupES && !cleanupPostgres) throw new Error('elasticsearch and postgres executions configured to be skipped, nothing to do');

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
    cleanupPostgres,
    cleanupES,
    payloadTimeout,
    esIndex,
    updateLimit,
  };
};

/**
 * parse environment variables to extract configuration and run cleanup of PG and ES executions
 *
 * @returns {Promise<void>}
 */
async function cleanExecutionPayloads() {
  const envConfig = parseEnvironment();
  log.info(`running cleanExecutions with configuration ${JSON.stringify(envConfig)}`);
  const {
    updateLimit,
    cleanupRunning,
    cleanupNonRunning,
    cleanupPostgres,
    cleanupES,
    payloadTimeout,
    esIndex,
  } = envConfig;

  const promises = [];
  if (cleanupES) {
    promises.push(cleanupExpiredESExecutionPayloads(
      payloadTimeout,
      cleanupRunning,
      cleanupNonRunning,
      updateLimit,
      esIndex
    ));
  }
  if (cleanupPostgres) {
    promises.push(cleanupExpiredPGExecutionPayloads(
      payloadTimeout,
      cleanupRunning,
      cleanupNonRunning,
      updateLimit
    ));
  }
  await Promise.all(promises);
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
  cleanExecutionPayloads,
  getExpirationDate,
  cleanupExpiredPGExecutionPayloads,
  cleanupExpiredESExecutionPayloads,
};
