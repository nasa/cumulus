'use strict';

const fs = require('fs-extra');
const test = require('ava');
const errors = require('@cumulus/common/errors');
const path = require('path');
const payload = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');
const payloadChecksumFile = require('@cumulus/test-data/payloads/new-message-schema/ingest-checksumfile.json'); // eslint-disable-line max-len
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

  validateConfig(t, t.context.event.config);
  validateInput(t, t.context.event.input);

  try {
    const output = await syncGranule(t.context.event);

    validateOutput(t, output);

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
  const granulePath = randomString();
  const localGranulePath = path.join(await findTmpTestDataDirectory(), granulePath);

  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:3030'
  };
  t.context.event.input.granules[0].files[0].path = `/${granulePath}`;

  validateConfig(t, t.context.event.config);
  validateInput(t, t.context.event.input);

  await fs.mkdir(localGranulePath);
  try {
    const granuleFilename = t.context.event.input.granules[0].files[0].name;

    // Stage the file to be downloaded
    await fs.copy(
      path.join(await findTestDataDirectory(), 'granules', granuleFilename),
      path.join(localGranulePath, granuleFilename)
    );

    const output = await syncGranule(t.context.event);

    validateOutput(t, output);

    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granules[0].files[0].filename,
      `s3://${t.context.protectedBucketName}/${granuleFilename}`
    );
  }
  catch (e) {
    if (e instanceof errors.RemoteResourceError) {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else throw e;
  }
  finally {
    fs.remove(localGranulePath);
  }
});

test('download Granule from SFTP endpoint', async (t) => {
  t.context.event.config.provider = t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'sftp',
    host: 'localhost',
    port: 2222,
    username: 'user',
    password: 'password'
  };

  t.context.event.input.granules[0].files[0].path = '/granules';

  validateConfig(t, t.context.event.config);
  validateInput(t, t.context.event.input);

  try {
    const granuleFilename = t.context.event.input.granules[0].files[0].name;

    const output = await syncGranule(t.context.event);

    validateOutput(t, output);

    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granules[0].files[0].filename,
      `s3://${t.context.protectedBucketName}/${granuleFilename}`
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

  validateConfig(t, t.context.event.config);
  validateInput(t, t.context.event.input);

  await s3().createBucket({ Bucket: t.context.event.config.provider.host }).promise();

  try {
    // Stage the file that's going to be downloaded
    await s3().putObject({
      Bucket: t.context.event.config.provider.host,
      Key: `${granuleFilePath}/${granuleFileName}`,
      Body: fs.createReadStream(`../../../packages/test-data/granules/${granuleFileName}`)
    }).promise();

    const output = await syncGranule(t.context.event);

    validateOutput(t, output);

    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granules[0].files[0].filename,
      `s3://${t.context.protectedBucketName}/${granuleFileName}` // eslint-disable-line max-len
    );
  }
  finally {
    // Clean up
    recursivelyDeleteS3Bucket(t.context.event.config.provider.host);
  }
});

test('download granule with checksum in file from an HTTP endpoint', async (t) => {
  const event = cloneDeep(payloadChecksumFile);

  event.config.buckets.internal = t.context.internalBucketName;
  event.config.buckets.private = t.context.privateBucketName;
  event.config.buckets.protected = t.context.protectedBucketName;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:3030'
  };

  const granulePath = randomString();
  event.input.granules[0].files[0].path = `/${granulePath}`;
  event.input.granules[0].files[1].path = `/${granulePath}`;

  validateConfig(t, event.config);
  validateInput(t, event.input);

  const localGranulePath = path.join(await findTmpTestDataDirectory(), granulePath);
  await fs.mkdir(localGranulePath);
  try {
    // Stage the files to be downloaded
    const sourceDir = path.join(await findTestDataDirectory(), 'granules');
    const granuleFilename = event.input.granules[0].files[0].name;
    const checksumFilename = event.input.granules[0].files[1].name;
    await Promise.all([
      fs.copy(path.join(sourceDir, granuleFilename),
        path.join(localGranulePath, granuleFilename)),
      fs.copy(path.join(sourceDir, checksumFilename),
        path.join(localGranulePath, checksumFilename))
    ]);

    const output = await syncGranule(event);

    validateOutput(t, output);

    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    t.is(output.granules[0].files[0].filename,
      `s3://${t.context.privateBucketName}/${granuleFilename}`);
  }
  catch (e) {
    if (e instanceof errors.RemoteResourceError) {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else throw e;
  }
  finally {
    // Clean up
    fs.remove(localGranulePath);
  }
});

// TODO Fix this test as part of https://bugs.earthdata.nasa.gov/browse/CUMULUS-272
// test.cb('replace duplicate Granule', (t) => {
//   const provider = {
//     id: 'MODAPS',
//     protocol: 'http',
//     host: 'http://localhost:3030'
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
