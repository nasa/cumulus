'use strict';

const AWS = require('aws-sdk');

const region = process.env.AWS_DEFAULT_REGION || 'us-west-2';
if (region) {
  AWS.config.update({ region: region });
}

// Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
AWS.util.update(AWS.S3.prototype, { addExpect100Continue: function addExpect100Continue() {} });
AWS.config.setPromisesDependency(Promise);

module.exports = {
  s3: new AWS.S3(),
  stepFunctions: new AWS.StepFunctions()
};
