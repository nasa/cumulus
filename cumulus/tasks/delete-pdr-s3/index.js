'use strict';

const aws = require('@cumulus/common/aws');

/**
 * Delete a PDR object from S3.
 *
 * @param {Object} s3Object - an Object with "Bucket" and "Key" properties
 * @returns {Promise}
 */
function deletePdr(s3Object) {
  return aws.deleteS3Files([s3Object]);
}

/**
 * @param {Object} event - see https://github.com/cumulus-nasa/cumulus/blob/master/packages/sled/README.md
 * @param {Object} context - see https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 * @param {Function} callback - see https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html#nodejs-prog-model-handler-callback
 * @returns {Promise}
 *
 * Example event:
 *
 * {
 *  input: {
 *    Bucket: 'my-bucket',
 *    Key: 'my/key.pdr'
 *  }
 * }
 */
function handler(event, context, callback) {
  return deletePdr(event.input)
    .then(() => callback())
    .catch(callback);
}
exports.handler = handler;
