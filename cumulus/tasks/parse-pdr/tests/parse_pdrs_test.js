'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs');
const test = require('ava');
const testUtils = require('@cumulus/common/test-utils');
const errors = require('@cumulus/common/errors');
const modis = require('@cumulus/test-data/payloads/new-message-schema/parse.json');

const { parsePdr } = require('../index');

test('error when provider info is missing', (t) => {
  const newPayload = Object.assign({}, modis);
  delete newPayload.config.provider;

  return parsePdr(newPayload)
    .then(t.fail)
    .catch((e) => t.true(e instanceof errors.ProviderNotFound));
});

test('parse PDR from FTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  const pdrName = 'MOD09GQ.PDR';

  const newPayload = Object.assign({}, modis);
  newPayload.config.provider = provider;
  newPayload.config.useQueue = false;

  const internalBucketName = testUtils.randomString();
  newPayload.config.bucket = internalBucketName;

  return aws.s3().createBucket({ Bucket: internalBucketName }).promise()
    .then(() => parsePdr(newPayload))
    .then((output) => {
      t.is(output.granules.length, output.granulesCount);
      t.is(output.pdr.name, pdrName);
      t.is(output.filesCount, 2);
      return aws.recursivelyDeleteS3Bucket(internalBucketName);
    })
    .catch((err) => {
      if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
        t.pass('ignoring this test. Test server seems to be down');
      }
      else t.fail(err);
      return aws.recursivelyDeleteS3Bucket(internalBucketName);
    });
});

test('parse PDR from HTTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  const pdrName = 'MOD09GQ.PDR';

  const newPayload = Object.assign({}, modis);
  newPayload.config.provider = provider;
  newPayload.config.useQueue = false;

  const internalBucketName = testUtils.randomString();
  newPayload.config.bucket = internalBucketName;

  return aws.s3().createBucket({ Bucket: internalBucketName }).promise()
    .then(() => parsePdr(newPayload))
    .then((output) => {
      t.is(output.granules.length, output.granulesCount);
      t.is(output.pdr.name, pdrName);
      t.is(output.filesCount, 2);

      return aws.recursivelyDeleteS3Bucket(internalBucketName);
    })
    .catch((err) => {
      if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
        t.pass('ignoring this test. Test server seems to be down');
      }
      else t.fail(err);
      return aws.recursivelyDeleteS3Bucket(internalBucketName);
    });
});

test('Parse a PDR from an S3 provider', async (t) => {
  const internalBucket = testUtils.randomString();
  const bucket = testUtils.randomString();
  const pdrName = 'MOD09GQ.PDR';

  await Promise.all([
    aws.s3().createBucket({ Bucket: bucket }).promise(),
    aws.s3().createBucket({ Bucket: internalBucket }).promise()
  ]);

  await aws.s3().putObject({
    Bucket: bucket,
    Key: pdrName,
    Body: fs.createReadStream('../../../packages/test-data/pdrs/MOD09GQ.PDR')
  }).promise();

  const event = Object.assign({}, modis);
  event.config.bucket = internalBucket;
  event.config.useQueue = false;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: bucket
  };

  event.input.pdr.path = null;

  let output;
  try {
    output = await parsePdr(event);
  }
  finally {
    await Promise.all([
      aws.recursivelyDeleteS3Bucket(bucket),
      aws.recursivelyDeleteS3Bucket(internalBucket)
    ]);
  }

  t.is(output.granules.length, output.granulesCount);
  t.is(output.pdr.name, pdrName);
  t.is(output.filesCount, 2);
});
