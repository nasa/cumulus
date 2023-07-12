// 'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const cryptoRandomString = require('crypto-random-string');
const mkdtemp = promisify(fs.mkdtemp);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);
const {
  createBucket,
  putFile,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const randomString = () => cryptoRandomString({ length: 10 });

const PerformanceTester = require('../../perf-test-utils');

// describe('the s3 interface, tested for performance', () => {
//   it('creates s3 buckets', () => {
//     const getBucketNames = (batchSize) => {
//       Array.from({ length: batchSize }, () => randomString());
//     };

//     const perf = new PerformanceTester(
//       createBucket,
//       1000,
//       100,
//       1,
//       getBucketNames
//     );

//     perf.performanceTest();
//   });
//   it('puts s3 files', async () => {
//     const bucket = 's3_test';
//     const tmpDir = await mkdtemp(`${os.tmpdir()}${path.sep}`);
//     const sourceFile = path.join(tmpDir, 'asdf');
//     await writeFile(sourceFile, 'asdf');
//     const getFileNames = (batchSize) => {
//       Array.from({ length: batchSize }, () => randomString());
//     };

//     const putFileWrapper = (key) => {
//       putFile(bucket, key, sourceFile);
//     };
//     const perf = new PerformanceTester(
//       putFileWrapper,
//       1000,
//       100,
//       1,
//       getFileNames
//     );

//     perf.performanceTest();
//   });
// });

/**
 *
 */
function testBucketCreation() {
  function getBucketNames(batchSize) {
    return Array.from({ length: batchSize }, () => randomString());
  }
  function wrappyDelete(bucketNames) {
    for (let i = 0; i < bucketNames.length; i += 1) {
      recursivelyDeleteS3Bucket(bucketNames[i]);
    }
  }
  const perf = new PerformanceTester(
    createBucket,
    1000,
    100,
    1,
    getBucketNames,
    wrappyDelete
  );

  perf.performanceTest();
}

/**
 *
 */
async function testFileCreation() {
  const bucket = 's3test';
  const tmpDir = await mkdtemp(`${os.tmpdir()}${path.sep}`);
  const sourceFile = path.join(tmpDir, 'asdf');
  await writeFile(sourceFile, 'asdf');
  createBucket(bucket);
  function getFileNames(batchSize) {
    return Array.from({ length: batchSize }, () => randomString());
  }
  // const getFileNames = (batchSize) => {
  //   Array.from({ length: batchSize }, () => randomString());
  // };

  const putFileWrapper = async (key) => {
    console.log(bucket, key, sourceFile);
    await putFile(bucket, key, sourceFile);
  };
  
  const perf = new PerformanceTester(
    putFileWrapper,
    10,
    10,
    1,
    getFileNames
  );

  perf.performanceTest();
  recursivelyDeleteS3Bucket(bucket);
}

// const bucketReg = testBucketCreation();
const fileReg = testFileCreation();
