'use strict';

const pWaitFor = require('p-wait-for');
const { s3ObjectExists } = require('@cumulus/aws-client/S3');

const waitForS3ObjectToExist = (Bucket, Key) =>
  pWaitFor(
    () => s3ObjectExists({ Bucket, Key }),
    { interval: 1000, timeout: 60000 }
  );

const waitForS3ObjectToNotExist = (Bucket, Key) =>
  pWaitFor(
    () => s3ObjectExists({ Bucket, Key }).then((exists) => !exists),
    { interval: 1000, timeout: 60000 }
  );

module.exports = {
  waitForS3ObjectToExist,
  waitForS3ObjectToNotExist
};
