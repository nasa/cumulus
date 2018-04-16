'use strict';

const { S3 } = require('aws-sdk');

/**
 * Lambda handler that tests GET access on an S3 bucket by calling
 * getObject on a file in the bucket. Calls the callback function
 * with a boolean that signifies whether or not the get was successful
 *
 * @param {Object} event - S3 bucket and key to test access
 *                         i.e. { Bucket: 's3-bucket', Key: 'test.txt' }
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  const s3 = new S3();

  s3.getObject(event)
    .promise()
    .then((result) => {
      callback(null, (result.Body !== null));
    })
    .catch(() => {
      callback(null, false);
    });
}

exports.handler = handler;
