const path = require('path');
const AWS = require('aws-sdk');
const get = require('lodash.get');

const { Execution } = require('packages/api/models');

async function handlePayload(event) {
  // const source = get(event, 'EventSource');
  // if (source !== 'aws:sns') {
  //   return;
  // }

  const snsMessage = get(event, 'Sns.Message');
  const payload = JSON.parse(snsMessage);

  let executionPromise;
  const executionModel = new Execution();
  if (['failed', 'completed'].includes(payload.meta.status)) {
    executionPromise = executionModel.updatexecutionModelExecutionFromSns(payload);
  } else {
    executionPromise = executionModel.createExecutionFromSns(payload);
  }

  return executionPromise;
}

async function handler(event) {
  const records = get(event, 'Records');
  return Promise.all(records.map(handlePayload));
}

module.exports = {
  handler
};
