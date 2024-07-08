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
 * @param {number} completeTimeoutDays - Maximum number of days a completed
 *   record may have payload entries
 * @param {number} nonCompleteTimeoutDays - Maximum number of days a non-completed
 *   record may have payload entries
 * @param {boolean} runComplete - Enable removal of completed execution
 *   payloads
 * @param {boolean} runNonComplete - Enable removal of execution payloads for
 *   statuses other than 'completed'
 * @returns {{
 *  laterExpiration: Date,
 *  completeExpiration: Date,
 *  nonCompleteExpiration: Date
 *  earlierExpiration: Date
 * }}
 */
const getExpirationDates = (
  completeTimeoutDays,
  nonCompleteTimeoutDays,
  runComplete,
  runNonComplete
) => {
  const completeExpiration = moment().subtract(completeTimeoutDays, 'days').toDate();
  const nonCompleteExpiration = moment().subtract(nonCompleteTimeoutDays, 'days').toDate();
  let laterExpiration;
  let earlierExpiration;
  if (runComplete && runNonComplete) {
    laterExpiration = new Date(Math.max(
      completeExpiration.getTime(),
      nonCompleteExpiration.getTime()
    ));
    earlierExpiration = new Date(Math.min(
      completeExpiration.getTime(),
      nonCompleteExpiration.getTime()
    ));
  } else if (runComplete) {
    laterExpiration = completeExpiration;
    earlierExpiration = completeExpiration;
  } else if (runNonComplete) {
    laterExpiration = nonCompleteExpiration;
    earlierExpiration = nonCompleteExpiration;
  } else {
    throw new Error('cannot run with both complete and nonComplete turned off');
  }

  return {
    laterExpiration,
    completeExpiration,
    nonCompleteExpiration,
    earlierExpiration,
  };
};

/**
 * Clean up PG and ES executions that have expired
 *
 * @param {number} completeTimeoutDays - Maximum number of days a completed
 *   record may have payload entries
 * @param {number} nonCompleteTimeoutDays - Maximum number of days a non-completed
 *   record may have payload entries
 * @param {boolean} runComplete - Enable removal of completed execution
 *   payloads
 * @param {boolean} runNonComplete - Enable removal of execution payloads for
 *   statuses other than 'completed'
 * @param {string | null} esIndex - optional ES index in which to clean up payloads.
 * @returns {Promise<void>}
*/
const cleanupExpiredExecutionPayloads = async (
  completeTimeoutDays,
  nonCompleteTimeoutDays,
  runComplete,
  runNonComplete,
  esIndex
) => {
  const {
    laterExpiration,
    completeExpiration,
    nonCompleteExpiration,
  } = getExpirationDates(
    completeTimeoutDays,
    nonCompleteTimeoutDays,
    runComplete,
    runNonComplete
  );
  const esClient = esIndex ? await getEsClient() : null;

  const knex = await getKnexClient();
  const updateLimit = Number(process.env.UPDATE_LIMIT || 10000);
  const executionModel = new ExecutionPgModel();
  const executionRecords = await executionModel.searchExecutionPayloadsBeforeDate(
    knex,
    laterExpiration,
    updateLimit
  );
  if (executionRecords.length === updateLimit) {
    log.warn(`running cleanup for ${updateLimit} out of maximum ${updateLimit} executions. more processing likely needed`);
  }
  const concurrencyLimit = Number(process.env.CONCURRENCY || 100);
  const limit = pLimit(concurrencyLimit);
  const wipedPayloads = {
    original_payload: null,
    final_payload: null,
  };
  const wipePayloads = async (cumulusId) => {
    await esClient?._client?.update(
      {
        index: esIndex,
        id: cumulusId,
        type: 'execution',
        body: { script: { inline: "ctx._source.remove('finalPayload'); ctx._source.remove('originalPayload')" } },
      }
    );
    return executionModel.update(knex, { cumulus_id: cumulusId }, wipedPayloads);
  };
  const updatePromises = executionRecords.map((entry) => limit(() => {
    if (runComplete && entry.status === 'completed' && entry.updated_at <= completeExpiration) {
      return wipePayloads(entry.cumulus_id);
    }
    if (runNonComplete && entry.status !== 'completed' && entry.updated_at <= nonCompleteExpiration) {
      return wipePayloads(entry.cumulus_id);
    }
    return Promise.resolve([]);
  }));
  await Promise.all(updatePromises);
};

/**
 * parse environment variables to extract configuration and run cleanup of PG and ES executions
 *
 * @returns {Promise<void>}
 */
async function cleanExecutionPayloads() {
  const completeDisable = JSON.parse(process.env.completeExecutionPayloadTimeoutDisable || 'false');
  const nonCompleteDisable = JSON.parse(process.env.nonCompleteExecutionPayloadTimeoutDisable || 'false');

  if (completeDisable) {
    log.info('skipping complete execution cleanup');
  }
  if (nonCompleteDisable) {
    log.info('skipping nonComplete execution cleanup');
  }
  if (completeDisable && nonCompleteDisable) {
    throw new Error('complete and nonComplete configured to be skipped, nothing to do');
  }

  const _nonCompleteTimeout = process.env.nonCompleteExecutionPayloadTimeout || '10';
  const nonCompleteTimeout = Number.parseInt(_nonCompleteTimeout, 10);
  if (!Number.isInteger(nonCompleteTimeout)) {
    throw new TypeError(`Invalid number of days specified in configuration for nonCompleteExecutionPayloadTimeout: ${_nonCompleteTimeout}`);
  }

  const _completeTimeout = process.env.completeExecutionPayloadTimeout || '10';
  const completeTimeout = Number.parseInt(_completeTimeout, 10);
  if (!Number.isInteger(completeTimeout)) {
    throw new TypeError(`Invalid number of days specified in configuration for completeExecutionPayloadTimeout: ${_completeTimeout}`);
  }

  const esIndex = process.env.ES_INDEX || 'cumulus';
  await cleanupExpiredExecutionPayloads(
    completeTimeout,
    nonCompleteTimeout,
    !completeDisable,
    !nonCompleteDisable,
    esIndex
  );
}

async function handler(_event) {
  return await cleanExecutionPayloads();
}
module.exports = {
  handler,
  cleanExecutionPayloads,
  getExpirationDates,
  cleanupExpiredExecutionPayloads,
};
