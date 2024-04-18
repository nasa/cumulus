import pRetry from 'p-retry';
import Logger from '@cumulus/logger';
import { isThrottlingException } from '@cumulus/errors';
import { CloudFormation } from '@aws-sdk/client-cloudformation';

const log = new Logger({ sender: 'aws-client/CloudFormationGateway' });

class CloudFormationGateway {
  constructor(
    private cloudFormationService: CloudFormation
  ) {}

  /**
   * Get the status of a CloudFormation stack
   *
   * @param {string} StackName
   * @returns {string} the stack status
   */
  async getStackStatus(StackName: string) {
    return await pRetry(
      async () => {
        try {
          const stackDetails = await this.cloudFormationService.describeStacks({
            StackName,
          });

          if (!stackDetails.Stacks) {
            throw new Error(`Could not fetch stack details of ${StackName}`);
          }

          return stackDetails.Stacks[0].StackStatus;
        } catch (error) {
          if (isThrottlingException(error)) throw new Error('Trigger retry');
          throw new pRetry.AbortError(error);
        }
      },
      {
        maxTimeout: 5000,
        onFailedAttempt: () => log.debug('ThrottlingException when calling cloudformation.describeStacks(), will retry.'),
      }
    );
  }
}

export = CloudFormationGateway;
