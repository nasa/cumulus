'use strict';

const cloneDeep = require('lodash.clonedeep');
const pRetry = require('p-retry');
const { lambda } = require('@cumulus/aws-client/services');
const CumulusApiClientError = require('./CumulusApiClientError');

function invokeApi(params) {
  const { prefix, payload } = cloneDeep(params);
  return pRetry(
    async () => {
      const apiOutput = await lambda().invoke({
        Payload: JSON.stringify(payload),
        FunctionName: `${prefix}-PrivateApiLambda`
      }).promise();
      const outputPayload = JSON.parse(apiOutput.Payload);
      if (outputPayload.errorMessage
        && outputPayload.errorMessage.includes('Task timed out')) {
        throw new CumulusApiClientError(`Error calling ${payload.path}: ${outputPayload.errorMessage}`);
      }
      return outputPayload;
    },
    {
      retries: 3,
      maxTimeout: 10000,
      onFailedAttempt: (error) => console.log(`API invoke error: ${error.message}. Retrying.`) // TODO - Logger
    }
  );
}

module.exports = { invokeApi };
