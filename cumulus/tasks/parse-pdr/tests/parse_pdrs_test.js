'use strict';

const aws = require('@cumulus/common/aws');
const test = require('ava');
const testUtils = require('@cumulus/common/test-utils');
const errors = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');
const modis = require('@cumulus/test-data/payloads/new-message-schema/parse.json');

const handler = require('../index').handler;

test.cb('error when provider info is missing', (t) => {
  const newPayload = Object.assign({}, modis);
  delete newPayload.config.provider;
  handler(newPayload, {}, (e) => {
    t.true(e instanceof errors.ProviderNotFound);
    t.end();
  });
});

test.cb('parse PDR from FTP endpoint', (t) => {
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
  newPayload.config.buckets.internal = internalBucketName;
  aws.s3().createBucket({ Bucket: internalBucketName }).promise()
    .then(() => {
      handler(newPayload, {}, (err, output) => {
        if (err) {
          if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
            log.info('ignoring this test. Test server seems to be down');
            return aws.recursivelyDeleteS3Bucket(internalBucketName).then(t.end);
          }
          return aws.recursivelyDeleteS3Bucket(internalBucketName)
            .then(() => t.end(err));
        }

        t.is(output.granules.length, output.granulesCount);
        t.is(output.pdr.name, pdrName);
        t.is(output.filesCount, 2);
        return aws.recursivelyDeleteS3Bucket(internalBucketName).then(t.end);
      });
    });
});

test.cb('parse PDR from HTTP endpoint', (t) => {
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
  newPayload.config.buckets.internal = internalBucketName;
  aws.s3().createBucket({ Bucket: internalBucketName }).promise()
    .then(() => {
      handler(newPayload, {}, (err, output) => {
        if (err) {
          if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
            log.info('ignoring this test. Test server seems to be down');
            return aws.recursivelyDeleteS3Bucket(internalBucketName).then(t.end);
          }
          return aws.recursivelyDeleteS3Bucket(internalBucketName)
            .then(() => t.end(err));
        }

        t.is(output.granules.length, output.granulesCount);
        t.is(output.pdr.name, pdrName);
        t.is(output.filesCount, 2);

        return aws.recursivelyDeleteS3Bucket(internalBucketName).then(t.end);
      });
    });
});
