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
} = require('@cumulus/aws-client/S3');

const randomString = () => cryptoRandomString({ length: 10 });

const PerformanceTester = require('../perf-test-utils');

describe('the s3 interface, tested for performance', () => {
  it('creates s3 buckets', () => {
    const getBucketNames = (batchSize) => {
      Array.from({ length: batchSize }, () => randomString());
    };

    const perf = new PerformanceTester(
      createBucket,
      1000,
      100,
      1,
      getBucketNames
    );

    perf.performanceTest();
  });
  it('puts s3 files', async () => {
    const bucket = 's3_test';
    const tmpDir = await mkdtemp(`${os.tmpdir()}${path.sep}`);
    const sourceFile = path.join(tmpDir, 'asdf');
    await writeFile(sourceFile, 'asdf');
    const getFileNames = (batchSize) => {
      Array.from({ length: batchSize }, () => randomString());
    };

    const putFileWrapper = (key) => {
      putFile(bucket, key, sourceFile);
    };
    const perf = new PerformanceTester(
      putFileWrapper,
      1000,
      100,
      1,
      getFileNames
    );

    perf.performanceTest();
  });
});
