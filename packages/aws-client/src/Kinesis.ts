/**
 * @module Kinesis
 */

import pRetry from 'p-retry';
import { DescribeStreamInput } from '@aws-sdk/client-kinesis';
import { kinesis } from './services';

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
        if (error.code === 'ResourceNotFoundException') throw error;
        throw new pRetry.AbortError(error);
      }
    },
    { maxTimeout: 10000, ...retryOptions }
  );
