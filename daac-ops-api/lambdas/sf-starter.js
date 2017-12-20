/* eslint-disable require-yield */
'use strict';

const get = require('lodash.get');
const AWS = require('aws-sdk');
const consumer = require('@cumulus/ingest/consumer');

async function dispatch(message) {
  const sfPayload = message.Body;

  // add creation time
  sfPayload.cumulus_meta.createdAt = Date.now();

  const stepfunctions = new AWS.StepFunctions();
  const params = {
    stateMachineArn: sfPayload.cumulus_meta.state_machine,
    input: JSON.stringify(sfPayload)
  };

  if (sfPayload.cumulus_meta.execution_name) {
    params.name = sfPayload.cumulus_meta.execution_name;
  }

  return stepfunctions.startExecution(params).promise();
}

function handler(event, context, cb) {
  const queueUrl = get(event, 'queueUrl', null);
  const messageLimit = get(event, 'messageLimit', 1);
  const timeLimit = get(event, 'timeLimit', 120);

  if (queueUrl) {
    const con = new consumer.Consume(queueUrl, messageLimit, timeLimit);
    con.read(dispatch).then(r => cb(null, r)).catch(e => cb(e));
  }
  else {
    cb(new Error('queueUrl is missing'));
  }
}

module.exports = handler;
