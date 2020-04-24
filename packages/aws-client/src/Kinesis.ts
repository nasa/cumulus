/**
 * Utility functions for interacting with Kinesis
 */
import { kinesis } from './services';
import pRetry = require('p-retry');

/**
 * Describe a Kinesis stream.
 */
export const describeStream = (
  params: AWS.Kinesis.DescribeStreamInput,
  retryOptions: pRetry.Options = { retries: 0 }
) =>
  pRetry(
    async () => {
      try {
        return await kinesis().describeStream(params).promise();
      } catch (err) {
        if (err.code === 'ResourceNotFoundException') throw err;
        throw new pRetry.AbortError(err);
      }
    },
    { maxTimeout: 10000, ...retryOptions }
  );
