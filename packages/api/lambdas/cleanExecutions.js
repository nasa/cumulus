'use strict';

const { ExecutionPgModel, getKnexClient } = require('@cumulus/db');
// const { RetryOnDbConnectionTerminateError } = require('@cumulus/db/retry');
const pLimit = require('p-limit');
const moment = require('moment');
const Logger = require('../../logger/dist');
const log = new Logger({
  sender: '@cumulus/api/lambdas/cleanExecutions',
})

/**
 * @typedef {import('@cumulus/db').PostgresExecutionRecord} PostgresExecutionRecord
 */

/**
 * Scan the Executions table and remove originalPayload/finalPayload records from the table
 *
 * @param {integer} completeTimeoutDays - Maximum number of days a completed
 *   record may have payload entries
 * @param {integer} nonCompleteTimeoutDays - Maximum number of days a non-completed
 *   record may have payload entries
 * @param {boolean} runComplete - Enable removal of completed execution
 *   payloads
 * @param {boolean} runNonComplete - Enable removal of execution payloads for
 *   statuses other than 'completed'
 * @returns {Object} - Execution table objects that were updated
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
  if (runComplete && runNonComplete) {
    laterExpiration = new Date(Math.max(completeExpiration, nonCompleteExpiration));
  } else if (runComplete) {
    laterExpiration = completeExpiration;
  } else if (runNonComplete) {
    laterExpiration = nonCompleteExpiration;
  } else {
    throw new Error('how did this happen?');
  }

  return {
    laterExpiration,
    completeExpiration,
    nonCompleteExpiration,
  };
};

/**
 * 
 * @param {Knex} knex
 * @param {ExecutionPgModel} executionModel
 * @param {Date} expiration
 * @param {number} limit
 * @returns {Promise<Array<PostgresExecutionRecord>>}
 */
const getExpirablePayloadRecords = async (
  knex,
  expiration,
  limit
) => {
  const query = knex(new ExecutionPgModel().tableName).
    where('updated_at', '<=', expiration)
    .where((builder) => {
      builder.whereNotNull('final_payload')
        .orWhereNotNull('original_payload');
    })
    .limit(limit);
  return await query;
};


const cleanupExpiredExecutionPayloads = async (
  completeTimeoutDays,
  nonCompleteTimeoutDays,
  runComplete,
  runNonComplete
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
  const knex = await getKnexClient();
  const updateLimit = process.env.UPDATE_LIMIT || 10000;
  const executionModel = new ExecutionPgModel();
  const executionRecords = await getExpirablePayloadRecords(
    knex,
    laterExpiration,
    updateLimit
  );
  if (executionRecords.length == updateLimit) {
    log.warn(`running cleanup for ${updateLimit} out of maximum ${updateLimit} executions. more processing likely needed`);
  }
  const concurrencyLimit = process.env.CONCURRENCY || 10;
  const limit = pLimit(concurrencyLimit);
  const updatePromises = executionRecords.map((entry) => limit(() => {
    const wipedPayloads = {
      original_payload: null,
      final_payload: null
    };
    if (runComplete && entry.status === 'completed' && entry.updated_at <= completeExpiration) {
      return executionModel.update(knex, { cumulus_id: entry.cumulus_id }, wipedPayloads);
    }
    if (runNonComplete && !(entry.status === 'completed') && entry.updated_at <= nonCompleteExpiration) {
      
      return executionModel.update(knex, { cumulus_id: entry.cumulus_id }, wipedPayloads);
    }
    return Promise.resolve();
  }));
  return await Promise.all(updatePromises);
};

async function cleanExecutionPayloads() {
  let completeDisable = process.env.completeExecutionPayloadTimeoutDisable || 'false';
  let nonCompleteDisable = process.env.nonCompleteExecutionPayloadTimeoutDisable || 'false';
  
  completeDisable = JSON.parse(completeDisable);
  if (completeDisable) {
    log.info('skipping complete execution cleanup');
  }

  nonCompleteDisable = JSON.parse(nonCompleteDisable);
  if (nonCompleteDisable) {
    log.info('skipping nonComplete execution cleanup')
  }
  if (completeDisable && nonCompleteDisable) {
    return [];
  }

  const nonCompleteTimeout = Number.parseInt(process.env.nonCompleteExecutionPayloadTimeout || '10', 10);
  if (!Number.isInteger(nonCompleteTimeout)) {
    throw new TypeError(`Invalid number of days specified in configuration for nonCompleteExecutionPayloadTimeout: ${nonCompleteTimeout}`);
  }
  const completeTimeout = Number.parseInt(process.env.completeExecutionPayloadTimeout || '10', 10);
  if (!Number.isInteger(nonCompleteTimeout)) {
    throw new TypeError(`Invalid number of days specified in configuration for completeExecutionPayloadTimeout: ${completeTimeout}`);
  }

  return await cleanupExpiredExecutionPayloads(
    completeTimeout,
    nonCompleteTimeout,
    !completeDisable,
    !nonCompleteDisable
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
  getExpirablePayloadRecords
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