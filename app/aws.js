'use strict';

const AWS = require('aws-sdk');

const region = process.env.AWS_DEFAULT_REGION || 'us-west-2';
if (region) {
  AWS.config.update({ region: region });
}

// Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
AWS.util.update(AWS.S3.prototype, { addExpect100Continue: function addExpect100Continue() {} });
AWS.config.setPromisesDependency(Promise);

/**
 * A map of real AWS services to use.
 */
const realServices = {
  s3: new AWS.S3(),
  stepFunctions: new AWS.StepFunctions()
};

/**
 * The current set of services to use for responses
 */
let currentServices = realServices;

/**
 * Takes a map of AWS services and puts them in place. Useful for unit testing.
 */
const useReplacementServices = (serviceMap) => {
  currentServices = serviceMap;
};

/**
 * Switches back to the real services.
 */
const useRealServices = () => {
  useReplacementServices(realServices);
};

module.exports = {
  useRealServices,
  useReplacementServices,
  s3: () => currentServices.s3,
  stepFunctions: () => currentServices.stepFunctions
};
