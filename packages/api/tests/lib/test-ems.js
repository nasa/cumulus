'use strict';

const test = require('ava');
const rewire = require('rewire');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
  s3PutObject
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const ems = rewire('../../lib/ems');
const retrievePrivateKey = ems.__get__('retrievePrivateKey');

test.before(async () => {
  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('retrievePrivateKey throws an error if they key does not exist', async (t) => {
  await t.throwsAsync(retrievePrivateKey(), {
    instanceOf: Error,
    message: 'ems-private.pem does not exist in S3 crypto directory'
  });
});

test.serial('retrievePrivateKey retrieves private key in default location', async (t) => {
  const privateKeyPath = `${process.env.stackName}/crypto/ems-private.pem`;

  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: privateKeyPath,
    Body: 'private-key'
  });

  const privateKey = await retrievePrivateKey();

  t.is(privateKey, 'private-key');

  await s3().deleteObject({ Bucket: process.env.system_bucket, Key: privateKeyPath }).promise();
});

test.serial('retrievePrivateKey retrieves private key in an alternate location', async (t) => {
  const privateKeyPath = `${process.env.stackName}/crypto/ems-private.pem`;
  const alternatePrivateKeyPath = `${process.env.stackName}/crypto/ems-private-alternate.pem`;
  process.env.ems_privateKey = 'ems-private-alternate.pem';

  await Promise.all([
    s3PutObject({
      Bucket: process.env.system_bucket,
      Key: privateKeyPath,
      Body: 'private-key'
    }),
    s3PutObject({
      Bucket: process.env.system_bucket,
      Key: alternatePrivateKeyPath,
      Body: 'alternate-private-key'
    })
  ]);

  const privateKey = await retrievePrivateKey();

  t.is(privateKey, 'alternate-private-key');

  process.env.ems_privateKey = null;
  await Promise.all([
    s3().deleteObject({ Bucket: process.env.system_bucket, Key: privateKeyPath }).promise(),
    s3().deleteObject({ Bucket: process.env.system_bucket, Key: alternatePrivateKeyPath }).promise()
  ]);
});
