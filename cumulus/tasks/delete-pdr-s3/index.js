'use strict';

const aws = require('@cumulus/common/aws');

/**
 * Delete a PDR object from S3.
 *
 * For documentation about the format of the incoming event, see
 * https://github.com/cumulus-nasa/cumulus/blob/master/packages/sled/README.md
 *
 * @param {Object} event - a cumulus sled event
 *
 * @example
 * handler({
 *  input: {
 *    bucket: 'my-bucket',
 *    key: 'my/key.pdr'
 *  }
 * }).then(() => console.log('PDR deleted'));
 */
function handler(event, context, callback) {
  return aws.deleteS3Files([
    {
      Bucket: event.input.bucket,
      Key: event.input.key
    }
  ])
    .then(() => callback())
    .catch(callback);
}
exports.handler = handler;
