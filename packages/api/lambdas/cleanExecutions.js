//@ts-check

'use strict';

const { ExecutionPgModel, getKnexClient } = require('@cumulus/db');
const { getEsClient } = require('@cumulus/es-client/search');
const pLimit = require('p-limit');
const moment = require('moment');
const Logger = require('@cumulus/logger');
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
 * @param {string} index - Elasticsearch index to cleanup
 * @returns {Promise<void>}
*/
const cleanupExpiredESExecutionPayloads = async (
  payloadTimeout,
  cleanupRunning,
  cleanupNonRunning,
  index
) => {
  const updateLimit = process.env.UPDATE_LIMIT || 10000;
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

  if(cleanupRunning && !cleanupNonRunning) {
    must.push({ term: { status: 'running' } });
  } else if ( !cleanupRunning && cleanupNonRunning) {
    mustNot.push({ term: { status: 'running' } })
  }
  const removePayloadScript = "ctx._source.remove('finalPayload'); ctx._source.remove('originalPayload')";
  
  let script = { inline: removePayloadScript };
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
  await esClient._client.updateByQuery({
    index,
    type: 'execution',
    size: updateLimit,
    body,
  });
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
) => {
  const expiration = getExpirationDate(payloadTimeout);
  const knex = await getKnexClient();
  const updateLimit = Number(process.env.UPDATE_LIMIT || 10000);
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
      else if(cleanupOnlyNonRunning) queryBuilder.where('status', '!=', 'running');
    })
    .limit(updateLimit)

  // this is done as a search:update because postgres doesn't support limited updates

  const concurrencyLimit = Number(process.env.CONCURRENCY || 100);
  const limit = pLimit(concurrencyLimit);
  await knex(executionModel.tableName)
    .whereIn('cumulus_id', executionIds.map((execution) => execution.cumulus_id))
    .update(wipedPayloads)
  // const updatePromises = executionIds.map((executionId) => limit(() => {
  //   return executionModel.update(knex, executionId, wipedPayloads)
  // }));
  // await Promise.all(updatePromises);
  
};

/**
 * parse environment variables to extract configuration and run cleanup of PG and ES executions
 *
 * @returns {Promise<void>}
 */
async function cleanExecutionPayloads() {
  const cleanupNonRunning = JSON.parse(process.env.cleanupNonRunning || 'true');
  const cleanupRunning = JSON.parse(process.env.cleanupRunning || 'false');

  if (cleanupRunning) {
    log.info('cleaning up running executions');
  }
  if (cleanupNonRunning) {
    log.info('cleaning up non-running executions');
  }

  if (!cleanupRunning && !cleanupNonRunning) {
    throw new Error('running and non-running executions configured to be skipped, nothing to do');
  }

  const _payloadTimeout = process.env.payloadTimeout || '10';
  const payloadTimeout = Number.parseInt(_payloadTimeout, 10);
  if (!Number.isInteger(payloadTimeout)) {
    throw new TypeError(`Invalid number of days specified in configuration for payloadTimeout: ${_payloadTimeout}`);
  }
  const esIndex = process.env.ES_INDEX || 'cumulus';
  await Promise.all([
    cleanupExpiredESExecutionPayloads(
      payloadTimeout,
      cleanupRunning,
      cleanupNonRunning,
      esIndex
    ),
    cleanupExpiredPGExecutionPayloads(
      payloadTimeout,
      cleanupRunning,
      cleanupNonRunning
    ),
  ]);
}

async function handler(_event) {
  return await cleanExecutionPayloads();
}
module.exports = {
  handler,
  cleanExecutionPayloads,
  getExpirationDate,
  cleanupExpiredPGExecutionPayloads,
  cleanupExpiredESExecutionPayloads,
};
