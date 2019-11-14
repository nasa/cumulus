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
  output.granules.forEach(({ files }) => t.is(files.length, 2));
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

    configure(t);

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
  discoverGranulesUsingS3(({ context: { event: { config } } }) => {
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }));

test('discover granules without collection files config using S3',
  discoverGranulesUsingS3(({ context: { event: { config } } }) => {
    // Without files config we should still discover granules, but the
    // discovered granules will have empty files arrays.
    config.collection.files = [];
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }, (t, output) => {
    validateOutput(t, output);
    t.is(output.granules.length, 3);
    output.granules.forEach(({ files }) => t.is(files.length, 0));
  }));

test('discover granules without collection files config, but configuring collection to ignore it, using S3',
  discoverGranulesUsingS3(({ context: { event: { config } } }) => {
    // Without files config we should still discover granules, and the
    // discovered granules' files arrays will include all files because we're
    // ignoring the (empty) files config for filtering files.
    config.collection.files = [];
    config.collection.ignoreFilesConfig = true;
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }, (t, output) => {
    validateOutput(t, output);
    t.is(output.granules.length, 3);
    output.granules.forEach(({ files }) => t.is(files.length, 2));
  }));

test('discover granules without collection files config, but configuring task to ignore it, using S3',
  discoverGranulesUsingS3(({ context: { event: { config } } }) => {
    // Without file configs we should still discover granules, and the
    // discovered granules files arrays will include all files because we're
    // ignoring the (empty) files config for filtering files.
    config.collection.files = [];
    config.ignoreFilesConfig = true;
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }, (t, output) => {
    validateOutput(t, output);
    t.is(output.granules.length, 3);
    output.granules.forEach(({ files }) => t.is(files.length, 2));
  }));

test('discover granules without collection files config, but configuring task to ignore it and overriding collection config not to ignore it, using S3',
  discoverGranulesUsingS3(({ context: { event: { config } } }) => {
    // Without files config we should still discover granules, and the
    // discovered granules files arrays should be empty even though the task is
    // configured to ignore the files config, but collection setting overrides
    // it to NOT ignore the files config.
    config.collection.files = [];
    config.ignoreFilesConfig = true;
    config.collection.ignoreFilesConfig = false;
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }, (t, output) => {
    validateOutput(t, output);
    t.is(output.granules.length, 3);
    output.granules.forEach(({ files }) => t.is(files.length, 0));
  }));

test('discover granules without collection files config for .nc files using S3',
  discoverGranulesUsingS3(({ context: { event: { config } } }) => {
    // With a collection files config that does not have a matching config for
    // all granule files, only matching files should end up in a granule's
    // files array.
    config.collection.files = config.collection.files.slice(1);
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }, (t, output) => {
    validateOutput(t, output);
    t.is(output.granules.length, 3);
    output.granules.forEach(({ files }) => t.is(files.length, 1));
  }));

test('discover granules using S3 throws error when discovery fails',
  async (t) => {
    const assert = discoverGranulesUsingS3(({ context: { event: { config } } }) => {
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
