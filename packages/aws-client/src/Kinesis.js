'use strict';

/**
 * Utility functions for interacting with Kinesis
 *
 * @module Kinesis
 *
 * @example
 * const Kinesis = require('@cumulus/aws-client/Kinesis');
 */

const pRetry = require('p-retry');

const { kinesis } = require('./services');

/**
 * Describe a Kinesis stream.
 *
 * @param {Object} params
 * @param {string} params.StreamName - A Kinesis stream name
 * @param {Object} retryOptions - Options passed to p-retry module
 * @returns {Promise<Object>} - The stream description response
 *
 * @alias module:Kinesis
 */
exports.describeStream = (params, retryOptions = { retries: 0 }) =>
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
