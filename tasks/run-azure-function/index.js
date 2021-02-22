'use strict';

const got = require('got');
const pWaitFor = require('p-wait-for');

const awsServices = require('@cumulus/aws-client/services');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const log = require('@cumulus/common/log');

const FUNCTION_REFRESH_INTERVAL_MS = 2000;
const FUNCTION_DEFAULT_TIMEOUT_MS = 300000;

async function queryTaskStatus(statusUri) {
  const response = await got.get(statusUri);
  return JSON.parse(response.body);
}

async function waitForTaskCompletion(statusUri) {
  await pWaitFor(
    async () => {
      const body = await queryTaskStatus(statusUri);

      return (body.runtimeStatus === 'Completed'
        || body.runtimeStatus === 'Failed');
    },
    { interval: FUNCTION_REFRESH_INTERVAL_MS,
      timeout: FUNCTION_DEFAULT_TIMEOUT_MS }
  );
}

async function runAzureFunction(event) {
  let response;

  try {
    response = await got.post(event.config.orchestratorURL, {
      json: event.input,
    });
  } catch (error) {
    log.error('Error response from orchestrator URL', error);
    throw error;
  }

  const body = JSON.parse(response.body);

  await waitForTaskCompletion(body.statusQueryGetUri);

  const status = await queryTaskStatus(body.statusQueryGetUri);

  return status.output;
}

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  const eventMessage = JSON.parse(event.Records[0].body);

  const sfn = awsServices.sfn();
  const taskToken = eventMessage.TaskToken;
  let messageAdapterOutput;

  try {
    messageAdapterOutput = await cumulusMessageAdapter
      .runCumulusTask(runAzureFunction, eventMessage, context);
  } catch (error) {
    log.error(error);
    return sfn.sendTaskFailure({
      error: error.message.substring(0, 256), // this field has length limits, idk
      taskToken,
    }).promise();
  }

  return sfn.sendTaskSuccess({
    output: JSON.stringify(messageAdapterOutput),
    taskToken,
  }).promise();
}
exports.handler = handler;
