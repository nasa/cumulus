/* eslint-disable no-await-in-loop */

'use strict';

const S3 = require('aws-sdk/clients/s3');

const objectExists = (params) =>
  (new S3()).headObject(params).promise()
    .then(() => true)
    .catch((e) => {
      if (e.code === 'NotFound') return false;
      throw e;
    });

const sleep = () => (new Promise((resolve) => setTimeout(resolve, 2000)));

module.exports.handler = async (event) => {
  let retries = 10;
  let objectFound;

  do {
    objectFound = await objectExists(event.meta.waitForS3ObjectToExistParams);
    if (!objectFound) await sleep();
    retries -= 1;
  } while (!objectFound && retries >= 0);

  return event;
};
