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

const assertDiscoveredGranules = (t, output) => {
  validateOutput(t, output);
  t.is(output.granules.length, 3);
  t.is(output.granules[0].files.length, 2);
  t.truthy(['data', 'metadata'].includes(output.granules[0].files[0].type));
};

test.beforeEach(async (t) => {
  const eventPath = path.join(__dirname, 'fixtures', 'mur.json');
  const rawEvent = await readFile(eventPath, 'utf8');
  t.context.event = JSON.parse(rawEvent);
});

test('discover granules sets the correct dataType for granules', async (t) => {
  const { event } = t.context;

  event.config.collection.provider_path = '/granules/fake_granules';
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030
  };

  validateConfig(t, event.config);

  try {
    const output = await discoverGranules(event);
    assertDiscoveredGranules(t, output);

    // Make sure we support datatype and collection name
    output.granules.forEach((granule) => {
      t.not(granule.dataType, event.config.collection.name);
    });
  } catch (e) {
    if (e.message === 'Connection Refused') {
      t.pass('Ignoring this test. Remote host seems to be down.');
    } else throw e;
  }
});

test('discover granules using FTP', async (t) => {
  const { event } = t.context;

  event.config.collection.provider_path = '/granules/fake_granules';
  event.config.useList = true;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass'
  };

  validateConfig(t, event.config);

  try {
    assertDiscoveredGranules(t, await discoverGranules(event));
  } catch (e) {
    if (e.message.includes('getaddrinfo ENOTFOUND')) {
      t.pass('Ignoring this test. Test server seems to be down');
    } else throw e;
  }
});

test('discover granules using SFTP', async (t) => {
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

  validateConfig(t, event.config);

  try {
    assertDiscoveredGranules(t, await discoverGranules(event));
  } catch (e) {
    if (e.code === 'ECONNREFUSED') {
      t.pass('Ignoring this test. Remote host seems to be down.');
    } else throw e;
  }
});

test('discover granules using HTTP', async (t) => {
  const { event } = t.context;

  event.config.collection.provider_path = '/granules/fake_granules';
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030
  };

  validateConfig(t, event.config);

  try {
    assertDiscoveredGranules(t, await discoverGranules(event));
  } catch (e) {
    if (e.message === 'Connection Refused') {
      t.pass('Ignoring this test. Remote host seems to be down.');
    } else throw e;
  }
});

const discoverGranulesUsingS3 = (configure, assert = assertDiscoveredGranules) =>
  async (t) => {
    const { event, event: { config } } = t.context;
    // State sample files
    const files = [
      'granule-1.nc', 'granule-1.nc.md5',
      'granule-2.nc', 'granule-2.nc.md5',
      'granule-3.nc', 'granule-3.nc.md5'
    ];

    config.sourceBucketName = randomString();
    config.collection.provider_path = randomString();

    configure(config);

    validateConfig(t, config);
    await s3().createBucket({ Bucket: config.sourceBucketName }).promise();

    try {
      await Promise.all(files.map((file) =>
        s3().putObject({
          Bucket: config.sourceBucketName,
          Key: `${config.collection.provider_path}/${file}`,
          Body: `This is ${file}`
        }).promise()));
      assert(t, await discoverGranules(event));
    } finally {
      // Clean up
      await recursivelyDeleteS3Bucket(config.sourceBucketName);
    }
  };

test('discover granules using S3',
  discoverGranulesUsingS3((config) => {
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }));

test('discover granules without collection files config using S3',
  discoverGranulesUsingS3((config) => {
    // Without file configs we should still discover granules, but the
    // discovered granules might have empty files arrays.
    config.collection.files = [];
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }, (t, output) => {
    validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 0);
  }));

test('discover granules using S3 throws error when discovery fails',
  async (t) => {
    const assert = discoverGranulesUsingS3((config) => {
      config.provider = {
        id: 'MODAPS',
        protocol: 's3',
        // Ignore config.sourceBucketName and use random bucket name to force
        // NoSuchBucket error.
        host: randomString()
      };
    });
    await t.throwsAsync(() => assert(t), { code: 'NoSuchBucket' });
  });
