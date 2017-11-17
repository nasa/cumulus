'use strict';

const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const _ = require('lodash');

/**
 * Queries AWS to determine the number of running excutions of a given state machine.
 * @param {string} stateMachineArn The ARN of the state machine to check.
 * @return {number} The number of running executions
 */
async function runningExecutionCount(stateMachineArn) {
  const data = await aws.sfn.listExecutions({
    stateMachineArn,
    statusFilter: 'RUNNING'
  }).promise();

  const count = data.executions.length;
  log.info(`Found ${count} running executions of ${stateMachineArn}.`);
  return count;
}

async function fetchMessages(queueUrl, count) {
  const maxNumberOfMessages = Math.min(count, 10);

  const data = await aws.sqs.receiveMessage({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: maxNumberOfMessages
  }).promise();

  const messages = data.Messages.map(JSON.parse) || [];
  // eslint-disable-next-line max-len
  log.info(`Tried to fetch ${maxNumberOfMessages} messages from ${queueUrl} and got ${messages.length}.`);
  return messages;
}

function startExecution(stateMachineArn, input) {
  log.info(`Starting an execution of ${stateMachineArn}`);

  return aws.sfn.startExecution({ stateMachineArn, input }).promise();
}

/**
 * Delete a message from an SQS queue.
 * @param {string} queueUrl The URL of the SQS queue.
 * @param {Object} message An SQS message, in the same format as received from
 *   AWS.SQS.receiveMessage().
 * @return {Promise}
 */
function deleteMessage(queueUrl, message) {
  log.info(`Deleting ${message.ReceiptHandle} from ${queueUrl}`);

  aws.sqs.deleteMessage({
    QueueUrl: queueUrl,
    ReceiptHandle: message.ReceiptHandle
  }).promise();
}

async function startExecutions(queueUrl, stateMachineArn, count) {
  log.info(`Starting ${count} executions of ${stateMachineArn}`);

  const messages = await fetchMessages(queueUrl, count);

  const executionPromises = messages.map((message) =>
    startExecution(stateMachineArn, message.body)
      .then(() => deleteMessage(queueUrl, message)));

  return Promise.all(executionPromises);
}

async function manageThrottledStepFunction(queueUrl, stateMachineArn, maxConcurrentExecutions) {
  const count = await runningExecutionCount(stateMachineArn);
  const executionsToStart = maxConcurrentExecutions - count;

  let sleepTimeInMs = 5000;

  if (executionsToStart > 0) {
    log.info('Executions to start: ', executionsToStart);
    await startExecutions(queueUrl, stateMachineArn, executionsToStart);
    sleepTimeInMs = 1000;
  }
  else {
    log.info('No executions to start');
  }

  log.info(`Sleeping for ${sleepTimeInMs} ms before managing ${stateMachineArn} again`);
  setTimeout(
    manageThrottledStepFunction,
    sleepTimeInMs,
    queueUrl,
    stateMachineArn,
    maxConcurrentExecutions,
  );
}

function mapLogicalIdsToArns(resources) {
  return _.fromPairs(resources.map((r) => [r.LogicalResourceId, r.PhysicalResourceId]));
}

async function buildExecutionConfigsFromEvent(event) {
  const stackResources = await aws.describeCfStackResources(event.cloudFormationStackName);
  const arnsByLogicalId = mapLogicalIdsToArns(stackResources);

  return event.stateMachineConfigs.map((stateMachineConfig) => {
    const id = `${event.stateMachinePrefix}${stateMachineConfig.stateMachineName}`;
    return _.set(stateMachineConfig, 'stateMachineArn', arnsByLogicalId[id]);
  });
}

module.exports.handler = function handler(event) {
  buildExecutionConfigsFromEvent(event)
    .then((executionConfigs) => {
      executionConfigs.forEach((executionConfig) => {
        manageThrottledStepFunction(
          executionConfig.queueUrl,
          executionConfig.stateMachineArn,
          executionConfig.maxConcurrentExecutions
        );
      });
    });
};
