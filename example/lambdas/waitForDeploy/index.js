'use strict';

const { promisify } = require('util');
const { CloudFormation } = require('aws-sdk');

const promisifiedSetTimeout = promisify(setTimeout);

const retryMs = 3000;
const maxRetries = 50;

/**
 * Waits for a stack deployment to occur. If no deployment
 * occurs, will time out and error.
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
  let deployStarted = false;

  /* eslint-disable no-await-in-loop */
  while (retries < maxRetries) {
    const stackDetails = await cloudformation.describeStacks({ StackName: stack })
      .promise()
      .catch((err) => callback(err));

    console.log(`stack status: ${JSON.stringify(stackDetails.Stacks[0].StackStatus)}`);

    if (stackDetails.Stacks[0].StackStatus.includes('IN_PROGRESS')) {
      deployStarted = true;
    }
    else if (deployStarted) { // state is not in progress and we know a deploy happened
      callback(null, event);
      return;
    }

    await promisifiedSetTimeout(retryMs);

    retries += 1;
  }

  callback(new Error('Stack not in complete state'));
}

exports.handler = handler;
