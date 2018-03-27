'use strict';

const errors = require('@cumulus/common/errors');
const fs = require('fs-extra');
const modis = require('@cumulus/test-data/payloads/new-message-schema/parse.json');
const path = require('path');
const test = require('ava');

const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { cloneDeep } = require('lodash');
const {
  findTestDataDirectory,
  findTmpTestDataDirectory,
  randomString,
  validateConfig,
  validateInput,
  validateOutput
} = require('@cumulus/common/test-utils');

const { parsePdr } = require('../index');

test('parse PDR from FTP endpoint', async (t) => {
  const internalBucketName = randomString();

  const newPayload = cloneDeep(modis);

  newPayload.config.bucket = internalBucketName;
  newPayload.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };
  newPayload.config.useList = true;

  await validateConfig(t, newPayload.config);

  return s3().createBucket({ Bucket: internalBucketName }).promise()
    .then(() => parsePdr(newPayload))
    .then((output) => {
      t.is(output.granules.length, output.granulesCount);
      t.is(output.pdr.name, newPayload.input.pdr.name);
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
  const testDataDirectory = path.join(await findTestDataDirectory(), 'pdrs');
  const providerPathDirectory = path.join(await findTmpTestDataDirectory(), providerPath);

  // Create providerPathDirectory and internal bucket
  await Promise.all([
    fs.ensureDir(providerPathDirectory),
    s3().createBucket({ Bucket: internalBucketName }).promise()
  ]);

  const pdrName = 'MOD09GQ.PDR';

  await fs.copy(
    path.join(testDataDirectory, pdrName),
    path.join(providerPathDirectory, pdrName));

  const newPayload = cloneDeep(modis);
  newPayload.config.bucket = internalBucketName;
  newPayload.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:3030'
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

  // Create providerPathDirectory and internal bucket
  await s3().createBucket({ Bucket: internalBucketName }).promise();

  const pdrName = 'MOD09GQ.PDR';

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
      path: 'pdrs'
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
    await recursivelyDeleteS3Bucket(internalBucketName);
  }
});

test('Parse a PDR from an S3 provider', async (t) => {
  const internalBucket = randomString();
  const bucket = randomString();
  const pdrName = 'MOD09GQ.PDR';

  await Promise.all([
    s3().createBucket({ Bucket: bucket }).promise(),
    s3().createBucket({ Bucket: internalBucket }).promise()
  ]);

  await s3().putObject({
    Bucket: bucket,
    Key: pdrName,
    Body: fs.createReadStream('../../packages/test-data/pdrs/MOD09GQ.PDR')
  }).promise();

  const event = cloneDeep(modis);
  event.config.bucket = internalBucket;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: bucket
  };

  event.input.pdr.path = '';

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  let output;
  try {
    output = await parsePdr(event);
  }
  finally {
    await Promise.all([
      recursivelyDeleteS3Bucket(bucket),
      recursivelyDeleteS3Bucket(internalBucket)
    ]);
  }

  await validateOutput(t, output);
  t.is(output.granules.length, output.granulesCount);
  t.is(output.pdr.name, pdrName);
  t.is(output.filesCount, 2);
});
