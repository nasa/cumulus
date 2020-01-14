'use strict';

const pRetry = require('p-retry');

const Logger = require('@cumulus/logger');
const { isThrottlingException } = require('@cumulus/errors');

const log = new Logger({ sender: 'aws-client/CloudFormationGateway' });
const privates = new WeakMap();

class CloudFormationGateway {
  constructor(cloudFormationService) {
    privates.set(this, { cloudFormationService });
  }

  /**
   * Get the status of a CloudFormation stack
   *
   * @param {string} StackName
   * @returns {string} the stack status
   */
  async getStackStatus(StackName) {
    const { cloudFormationService } = privates.get(this);

    return pRetry(
      async () => {
        try {
          const stackDetails = await cloudFormationService.describeStacks({
            StackName
          }).promise();

          return stackDetails.Stacks[0].StackStatus;
        } catch (err) {
          if (isThrottlingException(err)) throw new Error('Trigger retry');
          throw new pRetry.AbortError(err);
        }
      },
      {
        maxTimeout: 5000,
        onFailedAttempt: () => log.debug('ThrottlingException when calling cloudformation.describeStacks(), will retry.')
      }
    );
  }
}
module.exports = CloudFormationGateway;
