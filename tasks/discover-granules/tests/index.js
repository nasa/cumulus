'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const {
  randomString,
  validateConfig,
  validateOutput
} = require('@cumulus/common/test-utils');
const { promisify } = require('util');

const { discoverGranules } = require('..');

const readFile = promisify(fs.readFile);

test.beforeEach(async (t) => {
  const eventPath = path.join(__dirname, 'fixtures', 'mur.json');
  const rawEvent = await readFile(eventPath, 'utf8');
  t.context.event = JSON.parse(rawEvent);
});

test('discover granules sets the correct dataType for granules', async (t) => {
  const { event } = t.context;
  event.config.bucket = randomString();
  event.config.collection.provider_path = '/granules/fake_granules';
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030
  };

  await validateConfig(t, event.config);
  await s3().createBucket({ Bucket: event.config.bucket }).promise();

  try {
    const output = await discoverGranules(event);
    await validateOutput(t, output);

    // Make sure that there really were granules returned
    t.truthy(output.granules.length > 0);

    // Make sure we support datatype and collection name
    output.granules.forEach((granule) => {
      t.not(granule.dataType, event.config.collection.name);
    });
  }
  catch (err) {
    if (err.message === 'Connection Refused') {
      t.pass('Ignoring this test. Remote host seems to be down.');
    }
    else throw err;
  }
  finally {
    // Clean up
    await recursivelyDeleteS3Bucket(event.config.bucket);
  }
});

// This test is broken and will be fixed by CUMULUS-427
test.skip('discover granules using FTP', async (t) => {
  const { event } = t.context;
  event.config.bucket = randomString();
  event.config.collection.provider_path = '/granules/fake_granules';
  event.config.useList = true;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass'
  };

  await validateConfig(t, event.config);

  await s3().createBucket({ Bucket: event.config.bucket }).promise();

  try {
    const output = await discoverGranules(event);

    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  catch (e) {
    if (e.message.includes('getaddrinfo ENOTFOUND')) {
      t.pass('Ignoring this test. Test server seems to be down');
    }
    else t.fail(e);
  }
  finally {
    // Clean up
    await recursivelyDeleteS3Bucket(event.config.bucket);
  }
});

test('discover granules using SFTP', async (t) => {
  const internalBucketName = randomString();

  // Create providerPathDirectory and internal bucket
  await s3().createBucket({ Bucket: internalBucketName }).promise();

  const { event } = t.context;
  event.config.collection.provider_path = 'granules/fake_granules';
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'sftp',
    host: '127.0.0.1',
    port: 2222,
    username: 'user',
    password: 'password'
  };

  await validateConfig(t, event.config);

  try {
    const output = await discoverGranules(event);
    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  catch (err) {
    if (err.code === 'ECONNREFUSED') {
      t.pass('Ignoring this test. Remote host seems to be down.');
    }
    else throw err;
  }
  finally {
    // Clean up
    await recursivelyDeleteS3Bucket(internalBucketName);
  }
});

test('discover granules using HTTP', async (t) => {
  const { event } = t.context;
  event.config.bucket = randomString();
  event.config.collection.provider_path = '/granules/fake_granules';
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030
  };

  await validateConfig(t, event.config);
  await s3().createBucket({ Bucket: event.config.bucket }).promise();

  try {
    const output = await discoverGranules(event);
    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  catch (err) {
    if (err.message === 'Connection Refused') {
      t.pass('Ignoring this test. Remote host seems to be down.');
    }
    else throw err;
  }
  finally {
    // Clean up
    await recursivelyDeleteS3Bucket(event.config.bucket);
  }
});

test('discover granules using S3', async (t) => {
  const internalBucketName = randomString();
  const sourceBucketName = randomString();
  const providerPath = randomString();

  // Create providerPathDirectory and internal bucket
  await Promise.all([
    s3().createBucket({ Bucket: internalBucketName }).promise(),
    s3().createBucket({ Bucket: sourceBucketName }).promise()
  ]);

  // State sample files
  const files = [
    'granule-1.nc', 'granule-1.nc.md5',
    'granule-2.nc', 'granule-2.nc.md5',
    'granule-3.nc', 'granule-3.nc.md5'
  ];
  await Promise.all(files.map((file) =>
    s3().putObject({
      Bucket: sourceBucketName,
      Key: `${providerPath}/${file}`,
      Body: `This is ${file}`
    }).promise()));

  const { event } = t.context;
  event.config.collection.provider_path = providerPath;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: sourceBucketName
  };

  await validateConfig(t, event.config);

  try {
    const output = await discoverGranules(event);
    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  finally {
    // Clean up
    await Promise.all([
      recursivelyDeleteS3Bucket(internalBucketName),
      recursivelyDeleteS3Bucket(sourceBucketName)
    ]);
  }
});
