'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const mur = require('./fixtures/mur.json');
const { cloneDeep } = require('lodash');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const {
  findGitRepoRootDirectory,
  randomString,
  validateConfig,
  validateOutput
} = require('@cumulus/common/test-utils');
const { discoverGranules } = require('../index');

test('discover granules using FTP', async (t) => {
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
  const providerPath = randomString();

  // Figure out the directory paths that we're working with
  const gitRepoRootDirectory = await findGitRepoRootDirectory();
  const sftpTestDataDirectory = path.join(gitRepoRootDirectory, 'sftp-test-data');
  const providerPathDirectory = path.join(sftpTestDataDirectory, providerPath);

  // Create SFTP directory and internal bucket
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
  // The test-data prefix is required in the provider_path because of the way
  // that the sftp container is configured in docker-compose.yml.
  event.config.collection.provider_path = `test-data/${providerPath}`;
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
  finally {
    // Clean up
    await Promise.all([
      recursivelyDeleteS3Bucket(internalBucketName),
      fs.remove(providerPathDirectory)
    ]);
  }
});

test('discover granules using HTTP', async (t) => {
  const internalBucketName = randomString();
  const providerPath = randomString();

  // Figure out the directory paths that we're working with
  const gitRepoRootDirectory = await findGitRepoRootDirectory();
  const httpTestDataDirectory = path.join(gitRepoRootDirectory, 'http-test-data');
  const providerPathDirectory = path.join(httpTestDataDirectory, providerPath);

  // Create HTTP directory and internal bucket
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
    host: 'http://localhost:8080'
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
      fs.remove(providerPathDirectory)
    ]);
  }
});
