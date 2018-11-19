'use strict';

const { Execution } = require('../models');

async function cleanExecutionPayloads(ExecutionModel) {
  const timeout = parseInt(process.env.executionPayloadTimeout, 10);
  if (process.env.executionPayloadTimeout === 'disabled') {
    return [];
  }
  if (!Number.isInteger(timeout)) {
    throw new TypeError(`Invalid number of days specified in configuration for payload_timout: ${process.env.executionPayloadTimeout}`);
  }
  const execution = new ExecutionModel();
  return execution.removeOldPayloadRecords(timeout);
}

async function handler(_event) {
  return cleanExecutionPayloads(Execution);
}

exports.handler = handler;
exports.cleanExecutionPayloads = cleanExecutionPayloads;
