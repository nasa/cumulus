'use strict';

const test = require('ava');
const errors = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');
const payload = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');
const payloadChecksumFile = require(
  '@cumulus/test-data/payloads/new-message-schema/ingest-checksumfile.json'
);
const testUtils = require('@cumulus/common/test-utils');
const aws = require('@cumulus/common/aws');

const handler = require('../index').handler;

test.cb('error when provider info is missing', (t) => {
  const newPayload = Object.assign({}, payload);
  delete newPayload.config.provider;
  handler(newPayload, {}, (e) => {
    t.true(e instanceof errors.ProviderNotFound);
    t.end();
  });
});

test.cb('download Granule from FTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  const newPayload = Object.assign({}, payload);
  newPayload.config.provider = provider;

  const protectedBucketName = testUtils.randomString();
  const internalBucketName = testUtils.randomString();

  newPayload.config.buckets.protected = protectedBucketName;
  newPayload.config.buckets.internal = internalBucketName;

  aws.s3().createBucket({ Bucket: protectedBucketName }).promise()
    .then(() => aws.s3().createBucket({ Bucket: internalBucketName }).promise())
    .then(() =>
      handler(newPayload, {}, (e, output) => {
        return aws.recursivelyDeleteS3Bucket(protectedBucketName)
          .then(() => aws.recursivelyDeleteS3Bucket(internalBucketName))
          .then(() => {
            if (e) {
              if (e instanceof errors.RemoteResourceError) {
                log.info('ignoring this test. Test server seems to be down');
                return t.end();
              }
              return t.end(e);
            }

            t.is(output.granules.length, 1);
            t.is(output.granules[0].files.length, 1);
            t.is(
              output.granules[0].files[0].filename,
              `s3://${protectedBucketName}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`
            );
            return t.end();
          });
      }));
});

test.cb('download Granule from HTTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  const newPayload = Object.assign({}, payload);
  newPayload.config.provider = provider;

  const protectedBucketName = testUtils.randomString();
  const internalBucketName = testUtils.randomString();

  newPayload.config.buckets.protected = protectedBucketName;
  newPayload.config.buckets.internal = internalBucketName;

  aws.s3().createBucket({ Bucket: protectedBucketName }).promise()
    .then(() => aws.s3().createBucket({ Bucket: internalBucketName }).promise())
    .then(() =>
      handler(newPayload, {}, (e, output) => {
        return aws.recursivelyDeleteS3Bucket(protectedBucketName)
          .then(() => aws.recursivelyDeleteS3Bucket(internalBucketName))
          .then(() => {
            if (e) {
              if (e instanceof errors.RemoteResourceError) {
                log.info('ignoring this test. Test server seems to be down');
                return t.end();
              }
              return t.end(e);
            }

            t.is(output.granules.length, 1);
            t.is(output.granules[0].files.length, 1);
            t.is(
              output.granules[0].files[0].filename,
              `s3://${protectedBucketName}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`
            );
            return t.end();
          });
      }));
});

test.cb('download Granule with checksum in file', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  const newPayload = Object.assign({}, payloadChecksumFile);
  newPayload.config.provider = provider;

  const internalBucketName = testUtils.randomString();
  const privateBucketName = testUtils.randomString();
  const protectedBucketName = testUtils.randomString();

  newPayload.config.buckets.internal = internalBucketName;
  newPayload.config.buckets.private = privateBucketName;
  newPayload.config.buckets.protected = protectedBucketName;

  aws.s3().createBucket({ Bucket: protectedBucketName }).promise()
    .then(() => aws.s3().createBucket({ Bucket: internalBucketName }).promise())
    .then(() => aws.s3().createBucket({ Bucket: privateBucketName }).promise())
    .then(() =>
      handler(newPayload, {}, (e, output) => {
        return aws.recursivelyDeleteS3Bucket(protectedBucketName)
          .then(() => aws.recursivelyDeleteS3Bucket(internalBucketName))
          .then(() => aws.recursivelyDeleteS3Bucket(privateBucketName))
          .then(() => {
            if (e) {
              if (e instanceof errors.RemoteResourceError) {
                log.info('ignoring this test. Test server seems to be down');
                return t.end();
              }
              return t.end(e);
            }

            t.is(output.granules.length, 1);
            t.is(output.granules[0].files.length, 1);
            t.is(
            output.granules[0].files[0].filename,
              `s3://${privateBucketName}/20160115-MODIS_T-JPL-L2P-T2016015000000.L2_LAC_GHRSST_N-v01.nc.bz2`
            );
            return t.end();
          });
      }));
});

// TODO Get this test working
// test.cb('replace duplicate Granule', (t) => {
//   const provider = {
//     id: 'MODAPS',
//     protocol: 'http',
//     host: 'http://localhost:8080'
//   };
//   sinon.stub(S3, 'fileExists').callsFake(() => true);
//   const uploaded = sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

//   const newPayload = Object.assign({}, payload);
//   newPayload.provider = provider;
//   handler(newPayload, {}, (e, r) => {
//     S3.fileExists.restore();
//     S3.upload.restore();
//     if (e instanceof errors.RemoteResourceError) {
//       log.info('ignoring this test. Test server seems to be down');
//       return t.end();
//     }
//     t.true(uploaded.called);
//     return t.end(e);
//   });
// });

// TODO Get this test working
// test.cb('skip duplicate Granule', (t) => {
//   sinon.stub(S3, 'fileExists').callsFake(() => true);
//   const uploaded = sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

//   const newPayload = Object.assign({}, payload);
//   newPayload.config.collection.duplicateHandling = 'skip';
//   handler(newPayload, {}, (e, r) => {
//     S3.fileExists.restore();
//     S3.upload.restore();
//     if (e instanceof errors.RemoteResourceError) {
//       log.info('ignoring this test. Test server seems to be down');
//       return t.end();
//     }
//     t.false(uploaded.called);
//     return t.end(e);
//   });
// });
