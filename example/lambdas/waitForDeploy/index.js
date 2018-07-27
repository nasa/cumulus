'use strict';

const { promisify } = require('util');
const { CloudFormation } = require('aws-sdk');

const promisifiedSetTimeout = promisify(setTimeout);

const retryMs = 3000;
const maxRetries = 50;

/**
 * Waits for a stack deployment to occur
 *
 * @param {Object} event - AWS event
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
async function handler(event, context, callback) {
  const cloudformation = new CloudFormation();
  const stack = event.meta.stack;
  let retries = 0;

  const lambdaStartTime = new Date();

  /* eslint-disable no-await-in-loop */
  while (retries < maxRetries) {
    const stackDetails = await cloudformation.describeStacks({ StackName: stack })
      .promise()
      .catch((err) => callback(err));

    console.log(`stack status: ${JSON.stringify(stackDetails.Stacks[0].StackStatus)}`);

    const updateDateTime = new Date(stackDetails.Stacks[0].LastUpdatedTime);

    if (!stackDetails.Stacks[0].StackStatus.includes('IN_PROGRESS') &&
        updateDateTime > lambdaStartTime) {
      callback(null, event);
      return;
    }

    await promisifiedSetTimeout(retryMs);

    retries += 1;
  }

  callback(new Error('Stack not in complete state'));
}

exports.handler = handler;
