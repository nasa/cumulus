'use strict';

const test = require('ava');
const errors = require('@cumulus/common/errors');
const payload = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');
const payloadChecksumFile = require(
  '@cumulus/test-data/payloads/new-message-schema/ingest-checksumfile.json'
);
const testUtils = require('@cumulus/common/test-utils');
const aws = require('@cumulus/common/aws');

const { syncGranule } = require('../index');

test('error when provider info is missing', (t) => {
  const newPayload = Object.assign({}, payload);
  delete newPayload.config.provider;

  return syncGranule(newPayload)
    .then(t.fail)
    .catch((e) => {
      t.true(e instanceof errors.ProviderNotFound);
    });
});

test('download Granule from FTP endpoint', (t) => {
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

  return aws.s3().createBucket({ Bucket: protectedBucketName }).promise()
    .then(() => aws.s3().createBucket({ Bucket: internalBucketName }).promise())
    .then(() => syncGranule(newPayload))
    .then((output) => {
      t.is(output.granules.length, 1);
      t.is(output.granules[0].files.length, 1);
      t.is(
        output.granules[0].files[0].filename,
        `s3://${protectedBucketName}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`
      );

      return aws.recursivelyDeleteS3Bucket(internalBucketName);
    })
    .catch((e) => {
      if (e instanceof errors.RemoteResourceError) {
        t.pass('ignoring this test. Test server seems to be down');
      }
      else throw e;
    });
});

test('download Granule from HTTP endpoint', (t) => {
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

  return aws.s3().createBucket({ Bucket: protectedBucketName }).promise()
    .then(() => aws.s3().createBucket({ Bucket: internalBucketName }).promise())
    .then(() => syncGranule(newPayload))
    .then((output) => {
      t.is(output.granules.length, 1);
      t.is(output.granules[0].files.length, 1);
      t.is(
        output.granules[0].files[0].filename,
        `s3://${protectedBucketName}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`
      );

      return aws.recursivelyDeleteS3Bucket(internalBucketName);
    })
    .catch((e) => {
      if (e instanceof errors.RemoteResourceError) {
        t.pass('ignoring this test. Test server seems to be down');
      }
      else throw e;
    });
});

test('download Granule with checksum in file', (t) => {
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

  return aws.s3().createBucket({ Bucket: protectedBucketName }).promise()
    .then(() => aws.s3().createBucket({ Bucket: internalBucketName }).promise())
    .then(() => aws.s3().createBucket({ Bucket: privateBucketName }).promise())
    .then(() => syncGranule(newPayload))
    .then((output) => {
      t.is(output.granules.length, 1);
      t.is(output.granules[0].files.length, 1);
      t.is(
        output.granules[0].files[0].filename,
        `s3://${privateBucketName}/20160115-MODIS_T-JPL-L2P-T2016015000000.L2_LAC_GHRSST_N-v01.nc.bz2` // eslint-disable-line max-len
      );

      return aws.recursivelyDeleteS3Bucket(protectedBucketName)
        .then(() => aws.recursivelyDeleteS3Bucket(internalBucketName))
        .then(() => aws.recursivelyDeleteS3Bucket(privateBucketName));
    })
    .catch((e) =>
      aws.recursivelyDeleteS3Bucket(protectedBucketName)
        .then(() => aws.recursivelyDeleteS3Bucket(internalBucketName))
        .then(() => aws.recursivelyDeleteS3Bucket(privateBucketName))
        .then(() => {
          if (e instanceof errors.RemoteResourceError) {
            t.pass('ignoring this test. Test server seems to be down');
          }
          else throw e;
        }));
});

// // TODO Fix this test as part of https://bugs.earthdata.nasa.gov/browse/CUMULUS-272
// // test.cb('replace duplicate Granule', (t) => {
// //   const provider = {
// //     id: 'MODAPS',
// //     protocol: 'http',
// //     host: 'http://localhost:8080'
// //   };
// //   sinon.stub(S3, 'fileExists').callsFake(() => true);
// //   const uploaded = sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

// //   const newPayload = Object.assign({}, payload);
// //   newPayload.provider = provider;
// //   handler(newPayload, {}, (e, r) => {
// //     S3.fileExists.restore();
// //     S3.upload.restore();
// //     if (e instanceof errors.RemoteResourceError) {
// //       log.info('ignoring this test. Test server seems to be down');
// //       return t.end();
// //     }
// //     t.true(uploaded.called);
// //     return t.end(e);
// //   });
// // });

// // TODO Fix this test as part of https://bugs.earthdata.nasa.gov/browse/CUMULUS-272
// // test.cb('skip duplicate Granule', (t) => {
// //   sinon.stub(S3, 'fileExists').callsFake(() => true);
// //   const uploaded = sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

// //   const newPayload = Object.assign({}, payload);
// //   newPayload.config.collection.duplicateHandling = 'skip';
// //   handler(newPayload, {}, (e, r) => {
// //     S3.fileExists.restore();
// //     S3.upload.restore();
// //     if (e instanceof errors.RemoteResourceError) {
// //       log.info('ignoring this test. Test server seems to be down');
// //       return t.end();
// //     }
// //     t.false(uploaded.called);
// //     return t.end(e);
// //   });
// // });
