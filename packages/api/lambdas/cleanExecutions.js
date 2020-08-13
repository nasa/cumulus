'use strict';

const { Execution } = require('../models');

async function cleanExecutionPayloads(ExecutionModel) {
  let completeDisable = process.env.completeExecutionPayloadTimeoutDisable || 'false';
  let nonCompleteDisable = process.env.nonCompleteExecutionPayloadTimeoutDisable || 'false';

  completeDisable = JSON.parse(completeDisable);
  nonCompleteDisable = JSON.parse(nonCompleteDisable);

  if (completeDisable && nonCompleteDisable) {
    return [];
  }

  const nonCompleteTimeout = Number.parseInt(process.env.nonCompleteExecutionPayloadTimeout, 10);
  const completeTimeout = Number.parseInt(process.env.completeExecutionPayloadTimeout, 10);

  const configuration = [{
    name: 'nonCompleteExecutionPayloadTimeout',
    value: nonCompleteTimeout,
    originalValue: process.env.nonCompleteExecutionPayloadTimeout,
  },
  {
    name: 'completeExecutionPayloadTimeout',
    value: completeTimeout,
    originalValue: process.env.completeExecutionPayloadTimeout,
  }];

  configuration.forEach((timeout) => {
    if (!Number.isInteger(timeout.value)) {
      throw new TypeError(`Invalid number of days specified in configuration for ${timeout.name}: ${timeout.originalValue}`);
    }
  });

  const execution = new ExecutionModel();
  return execution.removeOldPayloadRecords(completeTimeout,
    nonCompleteTimeout,
    completeDisable,
    nonCompleteDisable);
}

async function handler(_event) {
  return cleanExecutionPayloads(Execution);
}

exports.handler = handler;
exports.cleanExecutionPayloads = cleanExecutionPayloads;
