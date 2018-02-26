'use strict';

const fs = require('fs');
const test = require('ava');
const errors = require('@cumulus/common/errors');
const payload = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');
const payloadChecksumFile = require(
  '@cumulus/test-data/payloads/new-message-schema/ingest-checksumfile.json'
);
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');

const { cloneDeep } = require('lodash');
const { randomString } = require('@cumulus/common/test-utils');

const { syncGranule } = require('../index');

// Setup buckets and the test event
test.beforeEach(async (t) => {
  t.context.internalBucketName = randomString();
  t.context.protectedBucketName = randomString();
  t.context.privateBucketName = randomString();

  await Promise.all([
    s3().createBucket({ Bucket: t.context.internalBucketName }).promise(),
    s3().createBucket({ Bucket: t.context.privateBucketName }).promise(),
    s3().createBucket({ Bucket: t.context.protectedBucketName }).promise()
  ]);

  t.context.event = cloneDeep(payload);

  t.context.event.config.buckets.internal = t.context.internalBucketName;
  t.context.event.config.buckets.private = t.context.privateBucketName;
  t.context.event.config.buckets.protected = t.context.protectedBucketName;
});

// Clean up
test.afterEach.always((t) => Promise.all([
  recursivelyDeleteS3Bucket(t.context.internalBucketName),
  recursivelyDeleteS3Bucket(t.context.privateBucketName),
  recursivelyDeleteS3Bucket(t.context.protectedBucketName)
]));

test('error when provider info is missing', async (t) => {
  delete t.context.event.config.provider;

  try {
    await syncGranule(t.context.event);
    t.fail();
  }
  catch (error) {
    t.true(error instanceof errors.ProviderNotFound);
  }
});

test('download Granule from FTP endpoint', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  try {
    const output = await syncGranule(t.context.event);

    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granules[0].files[0].filename,
      `s3://${t.context.protectedBucketName}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`
    );
  }
  catch (e) {
    if (e instanceof errors.RemoteResourceError) {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else throw e;
  }
});

test('download Granule from HTTP endpoint', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  try {
    const output = await syncGranule(t.context.event);

    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granules[0].files[0].filename,
      `s3://${t.context.protectedBucketName}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`
    );
  }
  catch (e) {
    if (e instanceof errors.RemoteResourceError) {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else throw e;
  }
});

test('download granule from S3 provider', async (t) => {
  const granuleFilePath = randomString();
  const granuleFileName = payload.input.granules[0].files[0].name;

  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: randomString()
  };

  t.context.event.input.granules[0].files[0].path = granuleFilePath;

  await s3().createBucket({ Bucket: t.context.event.config.provider.host }).promise();

  try {
    // Stage the file that's going to be downloaded
    await s3().putObject({
      Bucket: t.context.event.config.provider.host,
      Key: `${granuleFilePath}/${granuleFileName}`,
      Body: fs.createReadStream(`../../../packages/test-data/granules/${granuleFileName}`)
    }).promise();

    const output = await syncGranule(t.context.event);

    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granules[0].files[0].filename,
      `s3://${t.context.protectedBucketName}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf` // eslint-disable-line max-len
    );
  }
  finally {
    // Clean up
    recursivelyDeleteS3Bucket(t.context.event.config.provider.host);
  }
});

test('download Granule with checksum in file', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  try {
    const output = await syncGranule(t.context.event);

    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granules[0].files[0].filename,
      `s3://${t.context.privateBucketName}/20160115-MODIS_T-JPL-L2P-T2016015000000.L2_LAC_GHRSST_N-v01.nc.bz2` // eslint-disable-line max-len
    );
  }
  catch (e) {
    if (e instanceof errors.RemoteResourceError) {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else throw e;
  }
});

// TODO Fix this test as part of https://bugs.earthdata.nasa.gov/browse/CUMULUS-272
// test.cb('replace duplicate Granule', (t) => {
//   const provider = {
//     id: 'MODAPS',
//     protocol: 'http',
//     host: 'http://localhost:8080'
//   };
//   sinon.stub(S3, 'fileExists').callsFake(() => true);
//   const uploaded = sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

//   const newPayload = cloneDeep(payload);
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

// TODO Fix this test as part of https://bugs.earthdata.nasa.gov/browse/CUMULUS-272
// test.cb('skip duplicate Granule', (t) => {
//   sinon.stub(S3, 'fileExists').callsFake(() => true);
//   const uploaded = sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

//   const newPayload = cloneDeep(payload);
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
