'use strict';

const errors = require('@cumulus/common/errors');
const fs = require('fs-extra');
const modis = require('@cumulus/test-data/payloads/new-message-schema/parse.json');
const path = require('path');
const test = require('ava');

const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { cloneDeep } = require('lodash');
const {
  findGitRepoRootDirectory,
  randomString,
  validateConfig,
  validateInput,
  validateOutput
} = require('@cumulus/common/test-utils');

const { parsePdr } = require('../index');

test('parse PDR from FTP endpoint', async (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  const pdrName = 'MOD09GQ.PDR';

  const newPayload = cloneDeep(modis);
  newPayload.config.provider = provider;

  const internalBucketName = randomString();
  newPayload.config.bucket = internalBucketName;

  await validateConfig(t, newPayload.config);

  return s3().createBucket({ Bucket: internalBucketName }).promise()
    .then(() => parsePdr(newPayload))
    .then((output) => {
      t.is(output.granules.length, output.granulesCount);
      t.is(output.pdr.name, pdrName);
      t.is(output.filesCount, 2);
      return output;
    })
    .then((output) => validateOutput(t, output))
    .then(() => recursivelyDeleteS3Bucket(internalBucketName))
    .catch((err) => {
      if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
        t.pass('ignoring this test. Test server seems to be down');
      }
      else t.fail(err);
      return recursivelyDeleteS3Bucket(internalBucketName);
    });
});

test('parse PDR from HTTP endpoint', async (t) => {
  const internalBucketName = randomString();
  const providerPath = randomString();

  // Figure out the directory paths that we're working with
  const gitRepoRootDirectory = await findGitRepoRootDirectory();
  const providerPathDirectory = path.join(gitRepoRootDirectory, 'tmp-test-data', providerPath);

  // Create providerPathDirectory and internal bucket
  await Promise.all([
    fs.ensureDir(providerPathDirectory),
    s3().createBucket({ Bucket: internalBucketName }).promise()
  ]);

  const pdrName = 'MOD09GQ.PDR';

  await fs.copy(
    path.join(gitRepoRootDirectory, 'packages', 'test-data', 'pdrs', pdrName),
    path.join(providerPathDirectory, pdrName));

  const newPayload = cloneDeep(modis);
  newPayload.config.bucket = internalBucketName;
  newPayload.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };
  newPayload.input = {
    pdr: {
      name: pdrName,
      path: `/${providerPath}`
    }
  };

  await validateInput(t, newPayload.input);
  await validateConfig(t, newPayload.config);

  try {
    const output = await parsePdr(newPayload);
    await validateOutput(t, output);
    t.is(output.granules.length, output.granulesCount);
    t.is(output.pdr.name, pdrName);
    t.is(output.filesCount, 2);
  }
  catch (err) {
    if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else t.fail(err);
  }
  finally {
    // Clean up
    await Promise.all([
      recursivelyDeleteS3Bucket(internalBucketName),
      fs.remove(providerPathDirectory)
    ]);
  }
});

test('parse PDR from SFTP endpoint', async (t) => {
  const internalBucketName = randomString();
  const providerPath = randomString();

  // Figure out the directory paths that we're working with
  const gitRepoRootDirectory = await findGitRepoRootDirectory();
  const providerPathDirectory = path.join(gitRepoRootDirectory, 'tmp-test-data', providerPath);

  // Create providerPathDirectory and internal bucket
  await Promise.all([
    fs.ensureDir(providerPathDirectory),
    s3().createBucket({ Bucket: internalBucketName }).promise()
  ]);

  const pdrName = 'MOD09GQ.PDR';

  await fs.copy(
    path.join(gitRepoRootDirectory, 'packages', 'test-data', 'pdrs', pdrName),
    path.join(providerPathDirectory, pdrName));

  const newPayload = cloneDeep(modis);
  newPayload.config.bucket = internalBucketName;
  newPayload.config.provider = {
    id: 'MODAPS',
    protocol: 'sftp',
    host: 'localhost',
    port: 2222,
    username: 'user',
    password: 'password'
  };
  newPayload.input = {
    pdr: {
      name: pdrName,
      // The test-data prefix is required because of the way that the sftp
      // container is configured in docker-compose.yml.
      path: `/test-data/${providerPath}`
    }
  };

  await validateInput(t, newPayload.input);
  await validateConfig(t, newPayload.config);

  try {
    const output = await parsePdr(newPayload);
    await validateOutput(t, output);
    t.is(output.granules.length, output.granulesCount);
    t.is(output.pdr.name, pdrName);
    t.is(output.filesCount, 2);
  }
  catch (err) {
    if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else t.fail(err);
  }
  finally {
    // Clean up
    await Promise.all([
      recursivelyDeleteS3Bucket(internalBucketName),
      fs.remove(providerPathDirectory)
    ]);
  }
});
