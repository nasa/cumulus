'use strict';

const { Execution } = require('../models');

async function cleanExecutionPayloads(executionModel) {
  const timeout = parseInt(process.env.executionPayloadTimeout);
  if (process.env.executionPayloadTimeout === 'disabled') {
      return [];
  }
  if (!Number.isInteger(timeout)) {
      throw new Error(`Invalid number of days specified in configuration for payload_timout: ${process.env.executionPayloadTimeout}`);
  }
  const execution = new executionModel();
  return execution.removeOldPayloadRecords(timeout);
}

async function handler(event) {
  return await cleanExecutionPayloads(Execution);
}

exports.handler = handler;
exports.cleanExecutionPayloads = cleanExecutionPayloads;
