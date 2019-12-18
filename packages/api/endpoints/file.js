'use strict';

// const AWS = require('aws-sdk');
const aws = require('@cumulus/common/aws');

async function listBucketTfStateFiles(bucket) {
  const bucketObjects = await aws.listS3ObjectsV2({ Bucket: bucket });

  return bucketObjects.filter((obj) => obj.Key.includes('tfstate'));
}

async function listAllTfStateFiles() {
  const buckets = await aws.s3().listBuckets().promise();

  const bucketPromises = buckets.Buckets.map((bucket) =>
    listBucketTfStateFiles(bucket.Name));

  return Promise.all(bucketPromises);
}

async function listTfResources() {
  const stateFiles = await listAllTfStateFiles();
}

module.exports = {
  listAllTfStateFiles
};
