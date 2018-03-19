'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const mur = require('./fixtures/mur.json');
const { cloneDeep } = require('lodash');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const {
  findTmpTestDataDirectory,
  randomString,
  validateConfig,
  validateOutput
} = require('@cumulus/common/test-utils');
const { discoverGranules } = require('../index');

// This test is broken and will be fixed by CUMULUS-427
test.skip('discover granules using FTP', async (t) => {
  const event = cloneDeep(mur);

  await validateConfig(t, event.config);

  try {
    const output = await discoverGranules(event);

    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  catch (e) {
    if (e.message.includes('getaddrinfo ENOTFOUND')) {
      t.pass('Ignoring this test. Test server seems to be down');
    }
    else t.fail(e);
  }
});

test('discover granules using SFTP', async (t) => {
  const internalBucketName = randomString();

  // Create providerPathDirectory and internal bucket
  await s3().createBucket({ Bucket: internalBucketName }).promise();

  const event = cloneDeep(mur);
  event.config.collection.provider_path = 'granules/fake_granules';
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'sftp',
    host: 'localhost',
    port: 2222,
    username: 'user',
    password: 'password'
  };

  await validateConfig(t, event.config);

  try {
    const output = await discoverGranules(event);
    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  catch (err) {
    if (err.code === 'ECONNREFUSED') {
      t.pass('Ignoring this test. Remote host seems to be down.');
    }
    else throw err;
  }
  finally {
    // Clean up
    await recursivelyDeleteS3Bucket(internalBucketName);
  }
});

test('discover granules using HTTP', async (t) => {
  const internalBucketName = randomString();
  const providerPath = randomString();

  // Figure out the directory paths that we're working with
  const providerPathDirectory = path.join(await findTmpTestDataDirectory(), providerPath);

  // Create providerPathDirectory and internal bucket
  await Promise.all([
    fs.ensureDir(providerPathDirectory),
    s3().createBucket({ Bucket: internalBucketName }).promise()
  ]);

  // State sample files
  const files = [
    'granule-1.nc', 'granule-1.nc.md5',
    'granule-2.nc', 'granule-2.nc.md5',
    'granule-3.nc', 'granule-3.nc.md5'
  ];
  await Promise.all(files.map((file) =>
    fs.outputFile(path.join(providerPathDirectory, file), `This is ${file}`)));

  const event = cloneDeep(mur);
  event.config.collection.provider_path = providerPath;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:3030'
  };

  await validateConfig(t, event.config);

  try {
    const output = await discoverGranules(event);
    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  catch (err) {
    if (err.message === 'Connection Refused') {
      t.pass('Ignoring this test. Remote host seems to be down.');
    }
    else throw err;
  }
  finally {
    // Clean up
    await Promise.all([
      recursivelyDeleteS3Bucket(internalBucketName),
      fs.remove(providerPathDirectory)
    ]);
  }
});

test('discover granules using S3', async (t) => {
  const internalBucketName = randomString();
  const sourceBucketName = randomString();
  const providerPath = randomString();

  // Figure out the directory paths that we're working with
  const providerPathDirectory = path.join(await findTmpTestDataDirectory(), providerPath);

  // Create providerPathDirectory and internal bucket
  await Promise.all([
    fs.ensureDir(providerPathDirectory),
    s3().createBucket({ Bucket: internalBucketName }).promise(),
    s3().createBucket({ Bucket: sourceBucketName }).promise()
  ]);

  // State sample files
  const files = [
    'granule-1.nc', 'granule-1.nc.md5',
    'granule-2.nc', 'granule-2.nc.md5',
    'granule-3.nc', 'granule-3.nc.md5'
  ];
  await Promise.all(files.map((file) =>
    s3().putObject({
      Bucket: sourceBucketName,
      Key: `${providerPath}/${file}`,
      Body: `This is ${file}`
    }).promise()));

  const event = cloneDeep(mur);
  event.config.collection.provider_path = providerPath;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: sourceBucketName
  };

  await validateConfig(t, event.config);

  try {
    const output = await discoverGranules(event);
    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  finally {
    // Clean up
    await Promise.all([
      recursivelyDeleteS3Bucket(internalBucketName),
      recursivelyDeleteS3Bucket(sourceBucketName),
      fs.remove(providerPathDirectory)
    ]);
  }
});
