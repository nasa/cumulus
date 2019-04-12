'use strict';

const pRetry = require('p-retry');

const log = require('./log');
const { isThrottlingException } = require('./aws');

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
        onFailedAttempt: () => log.debug('ThrottlingException when calling cloudformation.describeStacks(), will retry.')
      }
    );
  }
}
module.exports = CloudFormationGateway;
