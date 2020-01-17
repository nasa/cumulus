'use strict';

const awsServices = require('@cumulus/aws-client/services');
const CloudFormationGateway = require('@cumulus/common/CloudFormationGateway');
const log = require('@cumulus/common/log');
const pRetry = require('p-retry');

const maxRetries = 50;

const isRunningStatus = (status) => status.endsWith('_IN_PROGRESS');

/**
 * Wait for a CloudFormation stack to finish deploying
 *
 * @param {CloudFormationGateway} cloudFormation - a CloudFormationGateway
 *   instance
 * @param {string} stackName - the name of the stack to wait for
 */
async function waitForDeployment(cloudFormation, stackName) {
  let deploymentHasStarted = false;

  await pRetry(
    async () => {
      const stackStatus = await cloudFormation.getStackStatus(stackName);

      log.info(`Stack status: ${JSON.stringify(stackStatus)}`);

      if (isRunningStatus(stackStatus)) {
        deploymentHasStarted = true;
      }

      if (!deploymentHasStarted || isRunningStatus(stackStatus)) {
        throw new Error('Waiting for deployment to finish');
      }
    },
    {
      retries: maxRetries,
      maxTimeout: 5000
    }
  );
}
exports.waitForDeployment = waitForDeployment;

/**
 * Waits for a stack deployment to occur. If no deployment
 * occurs, will time out and error.
 *
 * @param {Object} event - AWS event
 * @returns {Promise} - resolves when stack has reached terminal state
 */
async function handler(event) {
  const cloudFormation = new CloudFormationGateway(awsServices.cf());

  await waitForDeployment(cloudFormation, event.meta.stack);

  return event;
}
exports.handler = handler;
