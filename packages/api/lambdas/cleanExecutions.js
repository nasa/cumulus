'use strict';

const { Execution } = require('../models');

/**
 * Scans the execution table and remove input and output fields from
 * records that are older than the retention period
 * 
 * @param {Object} ExecutionModel - the execution model class
 * @returns {Promise} the result of removing old payload records 
 */
async function cleanExecutionPayloads(ExecutionModel) {
  const timeout = parseInt(process.env.executionPayloadRetentionPeriod, 10);
  if (process.env.executionPayloadRetentionPeriod === 'disabled') {
    return [];
  }
  if (!Number.isInteger(timeout)) {
    throw new TypeError('Invalid number of days specified for ' +
      `executionPayloadRetentionPeriod env variable. It must be a number: ${process.env.executionPayloadRetentionPeriod}`);
  }
  const execution = new ExecutionModel();
  return execution.removeOldPayloadRecords(timeout);
}

async function handler(_event) {
  return cleanExecutionPayloads(Execution);
}

exports.handler = handler;
exports.cleanExecutionPayloads = cleanExecutionPayloads;
