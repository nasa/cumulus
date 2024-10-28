/**
 * @module Kinesis
 */

import pRetry from 'p-retry';
import { DescribeStreamInput, ResourceNotFoundException } from '@aws-sdk/client-kinesis';
import { kinesis } from './services';

export { LimitExceededException } from '@aws-sdk/client-kinesis';

/**
 * Describe a Kinesis stream.
 *
 * @param {Object} params
 * @param {string} params.StreamName - A Kinesis stream name
 * @param {Object} retryOptions - Options passed to p-retry module
 * @returns {Promise<Object>} The stream description response
 */
export const describeStream = (
  params: DescribeStreamInput,
  retryOptions: pRetry.Options = { retries: 0 }
) =>
  pRetry(
    async () => {
      try {
        return await kinesis().describeStream(params);
      } catch (error) {
        if (error instanceof ResourceNotFoundException) throw error;
        throw new pRetry.AbortError(error);
      }
    },
    { maxTimeout: 10000, ...retryOptions }
  );
