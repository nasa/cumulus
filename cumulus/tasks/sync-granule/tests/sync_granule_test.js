'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs-extra');
const test = require('ava');
const errors = require('@cumulus/common/errors');
const path = require('path');

const payload = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');
const payloadChecksumFile = require('@cumulus/test-data/payloads/new-message-schema/ingest-checksumfile.json'); // eslint-disable-line max-len

const {
  findGitRepoRootDirectory,
  randomString,
  validateConfig,
  validateInput,
  validateOutput
} = require('@cumulus/common/test-utils');
const { cloneDeep } = require('lodash');
const { syncGranule } = require('../index');

test('download Granule from FTP endpoint', async (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  const newPayload = cloneDeep(payload);
  newPayload.config.provider = provider;

  const protectedBucketName = randomString();
  const internalBucketName = randomString();

  newPayload.config.buckets.protected = protectedBucketName;
  newPayload.config.buckets.internal = internalBucketName;

  await validateInput(t, newPayload.input);
  await validateConfig(t, newPayload.config);

  return aws.s3().createBucket({ Bucket: protectedBucketName }).promise()
    .then(() => aws.s3().createBucket({ Bucket: internalBucketName }).promise())
    .then(() => syncGranule(newPayload))
    .then((output) => validateOutput(t, output).then(() => output))
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

test('download Granule from HTTP endpoint', async (t) => {
  const granuleUrlPath = randomString();

  // Figure out the directory paths that we're working with
  const gitRepoRootDirectory = await findGitRepoRootDirectory();
  const tmpTestDataDirectory = path.join(gitRepoRootDirectory, 'tmp-test-data', granuleUrlPath);

  const granuleFilename = 'MOD09GQ.A2017224.h27v08.006.2017227165029.hdf';

  const event = cloneDeep(payload);
  event.config.buckets.internal = randomString();
  event.config.buckets.protected = randomString();
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };
  event.input.granules[0].files[0].path = `/${granuleUrlPath}`;

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  await fs.ensureDir(tmpTestDataDirectory);
  try {
    await Promise.all([
      fs.copy(
        path.join(gitRepoRootDirectory, 'packages', 'test-data', 'granules', granuleFilename),
        path.join(tmpTestDataDirectory, granuleFilename)),
      aws.s3().createBucket({ Bucket: event.config.buckets.internal }).promise(),
      aws.s3().createBucket({ Bucket: event.config.buckets.protected }).promise()
    ]);

    const output = await syncGranule(event);

    await validateOutput(t, output);
    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granules[0].files[0].filename,
      `s3://${event.config.buckets.protected}/${granuleFilename}`
    );
  }
  catch (e) {
    if (e instanceof errors.RemoteResourceError) {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else t.fail(e);
  }
  finally {
    await Promise.all([
      fs.remove(tmpTestDataDirectory),
      aws.recursivelyDeleteS3Bucket(event.config.buckets.internal),
      aws.recursivelyDeleteS3Bucket(event.config.buckets.protected)
    ]);
  }
});

test('download granule from S3 provider', async (t) => {
  const internalBucket = randomString();
  const protectedBucket = randomString();
  const sourceBucket = randomString();

  const granuleFilePath = randomString();
  const granuleFileName = payload.input.granules[0].files[0].name;

  // Create required buckets
  await Promise.all([
    aws.s3().createBucket({ Bucket: internalBucket }).promise(),
    aws.s3().createBucket({ Bucket: protectedBucket }).promise(),
    aws.s3().createBucket({ Bucket: sourceBucket }).promise()
  ]);

  // Stage the file that's going to be downloaded
  await aws.s3().putObject({
    Bucket: sourceBucket,
    Key: `${granuleFilePath}/${granuleFileName}`,
    Body: fs.createReadStream(`../../../packages/test-data/granules/${granuleFileName}`)
  }).promise();

  const event = Object.assign({}, payload);
  event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: sourceBucket
  };
  event.config.buckets.internal = internalBucket;
  event.config.buckets.protected = protectedBucket;

  event.input.granules[0].files[0].path = granuleFilePath;

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  let output;
  try {
    output = await syncGranule(event);
  }
  finally {
    // Clean up
    await Promise.all([
      aws.recursivelyDeleteS3Bucket(internalBucket),
      aws.recursivelyDeleteS3Bucket(protectedBucket),
      aws.recursivelyDeleteS3Bucket(sourceBucket)
    ]);
  }

  await validateOutput(t, output);
  t.is(output.granules.length, 1);
  t.is(output.granules[0].files.length, 1);
  t.is(
    output.granules[0].files[0].filename,
    `s3://${protectedBucket}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`
  );
});

test('download granule over HTTP with checksum in file', async (t) => {
  const granuleUrlPath = randomString();

  // Figure out the directory paths that we're working with
  const gitRepoRootDirectory = await findGitRepoRootDirectory();
  const tmpTestDataDirectory = path.join(gitRepoRootDirectory, 'tmp-test-data', granuleUrlPath);

  const granuleFilename = '20160115-MODIS_T-JPL-L2P-T2016015000000.L2_LAC_GHRSST_N-v01.nc.bz2';
  const checksumFilename = '20160115-MODIS_T-JPL-L2P-T2016015000000.L2_LAC_GHRSST_N-v01.nc.bz2.md5';

  const event = cloneDeep(payloadChecksumFile);
  event.config.buckets.internal = randomString();
  event.config.buckets.private = randomString();
  event.config.buckets.protected = randomString();
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };
  event.input.granules[0].files[0].path = `/${granuleUrlPath}`;
  event.input.granules[0].files[1].path = `/${granuleUrlPath}`;

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  await fs.ensureDir(tmpTestDataDirectory);
  try {
    await Promise.all([
      fs.copy(
        path.join(gitRepoRootDirectory, 'packages', 'test-data', 'granules', granuleFilename),
        path.join(tmpTestDataDirectory, granuleFilename)),
      fs.copy(
        path.join(gitRepoRootDirectory, 'packages', 'test-data', 'granules', checksumFilename),
        path.join(tmpTestDataDirectory, checksumFilename)),
      aws.s3().createBucket({ Bucket: event.config.buckets.internal }).promise(),
      aws.s3().createBucket({ Bucket: event.config.buckets.private }).promise(),
      aws.s3().createBucket({ Bucket: event.config.buckets.protected }).promise()
    ]);

    const output = await syncGranule(event);

    await validateOutput(t, output);
    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granules[0].files[0].filename,
      `s3://${event.config.buckets.private}/${granuleFilename}` // eslint-disable-line max-len
    );
  }
  catch (e) {
    if (e instanceof errors.RemoteResourceError) {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else t.fail(e);
  }
  finally {
    await Promise.all([
      fs.remove(tmpTestDataDirectory),
      aws.recursivelyDeleteS3Bucket(event.config.buckets.internal),
      aws.recursivelyDeleteS3Bucket(event.config.buckets.private),
      aws.recursivelyDeleteS3Bucket(event.config.buckets.protected)
    ]);
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

// TODO Fix this test as part of https://bugs.earthdata.nasa.gov/browse/CUMULUS-272
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
