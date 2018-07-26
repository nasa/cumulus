'use strict';

const { promisify } = require('util');
const { CloudFormation } = require('aws-sdk');

const promisifiedSetTimeout = promisify(setTimeout);

const retryMs = 1000;
const maxRetries = 30;

/**
 * Receives event trigger from SNS and forwards event message to S3 bucket
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

  /* eslint-disable no-await-in-loop */
  while (retries < maxRetries) {
    const stackDetails = await cloudformation.describeStacks({ StackName: stack })
      .promise()
      .catch((err) => callback(err));

    console.log(`stack status: ${JSON.stringify(stackDetails.Stacks[0].StackStatus)}`);

    if (!stackDetails.Stacks[0].StackStatus.includes('IN_PROGRESS')) {
      callback(null, event);
      return;
    }

    await promisifiedSetTimeout(retryMs);

    retries += 1;
  }

  callback(new Error('Stack not in complete state'));
}

exports.handler = handler;
