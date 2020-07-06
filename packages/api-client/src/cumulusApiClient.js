'use strict';

const pRetry = require('p-retry');
const Logger = require('@cumulus/logger');
const { lambda } = require('@cumulus/aws-client/services');
const CumulusApiClientError = require('./CumulusApiClientError');

const logger = new Logger({ sender: '@api-client/cumulusApiClient' });

/**
 * Invoke the Cumulus private API lambda (using pRetry)
 *
 * @param {Object} params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.payload .  - the payload object (e.g. httpMethod, resource,
 *                                     headers, path, body) containing params the lambda expects
 *                                     in the payload
 * @returns {Promise<Object>}        - Returns promise that resolves to the output payload from the
 *                                     API lambda
 */
function invokeApi({ prefix, payload }) {
  return pRetry(
    async () => {
      const apiOutput = await lambda().invoke({
        Payload: JSON.stringify(payload),
        FunctionName: `${prefix}-PrivateApiLambda`
      }).promise();
      const outputPayload = JSON.parse(apiOutput.Payload);
      if (outputPayload.errorMessage &&
        outputPayload.errorMessage.includes('Task timed out')) {
        throw new CumulusApiClientError(`Error calling ${payload.path}: ${outputPayload.errorMessage}`);
      }
      return outputPayload;
    },
    {
      retries: 3,
      maxTimeout: 10000,
      onFailedAttempt: (error) => logger.error(`API invoke error: ${error.message}. Retrying.`)
    }
  );
}

module.exports = { invokeApi };
