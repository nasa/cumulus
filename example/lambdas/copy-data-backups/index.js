/* eslint-disable */

const AWS = require('aws-sdk');

const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

exports.handler = async (event) => {
  return s3.copyObject({
    Bucket: event.destinationBucket,
    CopySource: `/${event.sourceBucket}/${event.sourceKey}`,
    Key: event.destinationKey,
  }).promise();
}
