'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { tmpdir } = require('os');
const cryptoRandomString = require('crypto-random-string');
const pTimeout = require('p-timeout');
const { Readable } = require('stream');
const { promisify } = require('util');
const AWS = require('aws-sdk');
const { UnparsableFileLocationError } = require('@cumulus/errors');

const {
  createBucket,
  getJsonS3Object,
  getObjectSize,
  getS3Object,
  getTextObject,
  headObject,
  downloadS3File,
  listS3ObjectsV2,
  recursivelyDeleteS3Bucket,
  s3Join,
  validateS3ObjectChecksum,
  getFileBucketAndKey,
  putFile,
  calculateObjectHash,
  getObjectReadStream,
  streamS3Upload,
  getObjectStreamContents,
  uploadS3FileStream,
  deleteS3Objects,
  promiseS3Upload,
  fileExists,
} = require('@cumulus/aws-client/S3');
const awsServices = require('@cumulus/aws-client/services');
const { streamToString } = require('@cumulus/aws-client/test-utils');

const mkdtemp = promisify(fs.mkdtemp);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);
const PolynomialRegression = require('ml-regression-polynomial');
// Not using @cumulus/common/sleep() because adding @cumulus/common as a dependency introduces a
// circular dependency.
const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

const randomString = () => cryptoRandomString({ length: 10 });

const randomInt = (min, max) => { return Math.floor(Math.random() * (max - min) + min)} ;
const createBuckets = async (bucketNames) => {
  for (let i = 0; i < bucketNames.length; i += 1) {
    const bucketName = bucketNames[i];
    const creation = await createBucket(bucketName);
  }
};
const deleteBuckets = async (bucketNames) => {
  for (let i = 0; i < bucketNames.length; i += 1) {
    const bucketName = bucketNames[i];
    console.log('deleting'); console.log(bucketName);
    const head = await awsServices.s3().headBucket({ Bucket: bucketName });
    console.log(head);
    const del = await recursivelyDeleteS3Bucket(bucketName);
    console.log(del);
  }
};
const measureBatch = async (bucketNames) => {
  const startCreate = Date.now();
  await createBuckets(bucketNames);
  const endCreate = Date.now();
  const startDelete = Date.now();
  // await deleteBuckets(bucketNames);
  const endDelete = Date.now();
  return [
    bucketNames.length,
    endCreate - startCreate,
    endDelete - startDelete,
  ];
};
async function runCreateDelete() {

  let batchSizes = [];
  let creationTimes = [];
  let deletionTimes = [];
  for (let i = 0; i < 1000; i += 1) {
    const batchSize = randomInt(3, 100);
    const bucketNames = Array.from({ length: batchSize }, () => randomString());
    const metrics = await measureBatch(bucketNames);
    batchSizes.push(metrics[0]);
    creationTimes.push(metrics[1]);
    deletionTimes.push(metrics[2]);
  }
  const maxDegree = 3;
  const createRegression = new PolynomialRegression(batchSizes, creationTimes, maxDegree);
  // const deleteRegression = new PolynomialRegression(batchSizes, deletionTimes, maxDegree);
  
  console.log(createRegression.toLaTeX(2));
  // console.log(deleteRegression.toLaTeX(2));

};

AWS.config.logger = console;
const logplease = require('logplease');
logplease.setLogLevel('DEBUG')
runCreateDelete();