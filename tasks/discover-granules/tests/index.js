'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const rewire = require('rewire');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const {
  randomString,
  validateConfig,
  validateOutput
} = require('@cumulus/common/test-utils');
const { promisify } = require('util');

const discoverGranulesRewire = rewire('..')
const discoverGranules = discoverGranulesRewire.discoverGranules;

const readFile = promisify(fs.readFile);

// rewire used for filterDuplicateGranules tests
const checkDuplicateRewire = (granuleId, dupeConfig, _) => {
  if (granuleId === 'duplicate') {
    if (dupeConfig.duplicateHandling === 'error') {
      throw new Error(`Duplicate GranuleID ${granuleId} encountered in DiscoverGranules with duplicateHandling set to 'error'`);
    }
    return '';
  }
  return granuleId;
};

async function assertDiscoveredGranules(t, output) {
  await validateOutput(t, output);
  t.is(output.granules.length, 3);
  output.granules.forEach(({ files }) => t.is(files.length, 2));
  t.truthy(['data', 'metadata'].includes(output.granules[0].files[0].type));
}

test.beforeEach(async (t) => {
  const eventPath = path.join(__dirname, 'fixtures', 'mur.json');
  const rawEvent = await readFile(eventPath, 'utf8');
  t.context.event = JSON.parse(rawEvent);
  t.context.filesByGranuleId = {
    duplicate: {},
    notDuplicate: {},
    someOtherGranule: {}
  };
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

  await validateConfig(t, event.config);

  try {
    const output = await discoverGranules(event);
    await assertDiscoveredGranules(t, output);

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

  await validateConfig(t, event.config);

  try {
    await assertDiscoveredGranules(t, await discoverGranules(event));
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

  await validateConfig(t, event.config);

  try {
    await assertDiscoveredGranules(t, await discoverGranules(event));
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

  await validateConfig(t, event.config);

  try {
    await assertDiscoveredGranules(t, await discoverGranules(event));
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

    await validateConfig(t, config);
    await s3().createBucket({ Bucket: config.sourceBucketName }).promise();

    try {
      await Promise.all(files.map((file) =>
        s3().putObject({
          Bucket: config.sourceBucketName,
          Key: `${config.collection.provider_path}/${file}`,
          Body: `This is ${file}`
        }).promise()));
      await assert(t, await discoverGranules(event));
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
  }, async (t, output) => {
    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    output.granules.forEach(({ files }) => t.is(files.length, 0));
  }));

test('discover granules without collection files config, but configuring collection to ignore it, using S3',
  discoverGranulesUsingS3(({ context: { event: { config } } }) => {
    // Without files config we should still discover granules, and the
    // discovered granules' files arrays will include all files because we're
    // ignoring the (empty) files config for filtering files.
    config.collection.files = [];
    config.collection.ignoreFilesConfigForDiscovery = true;
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }, async (t, output) => {
    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    output.granules.forEach(({ files }) => t.is(files.length, 2));
  }));

test('discover granules without collection files config, but configuring task to ignore it, using S3',
  discoverGranulesUsingS3(({ context: { event: { config } } }) => {
    // Without file configs we should still discover granules, and the
    // discovered granules files arrays will include all files because we're
    // ignoring the (empty) files config for filtering files.
    config.collection.files = [];
    config.ignoreFilesConfigForDiscovery = true;
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }, async (t, output) => {
    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    output.granules.forEach(({ files }) => t.is(files.length, 2));
  }));

test('discover granules without collection files config, but configuring task to ignore it and overriding collection config not to ignore it, using S3',
  discoverGranulesUsingS3(({ context: { event: { config } } }) => {
    config.collection.files = [];
    config.ignoreFilesConfigForDiscovery = false;
    config.collection.ignoreFilesConfigForDiscovery = true;
    config.provider = {
      id: 'MODAPS',
      protocol: 's3',
      host: config.sourceBucketName
    };
  }, async (t, output) => {
    await validateOutput(t, output);
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
  }, async (t, output) => {
    await validateOutput(t, output);
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

test('filterDuplicateGranules filters on duplicateHandling set to "skip"',
  async (t) => {
    const filterDuplicateGranules = discoverGranulesRewire.__get__('filterDuplicateGranules');
    const checkDuplicateRestore = discoverGranulesRewire.__set__('checkDuplicate', checkDuplicateRewire);
    const getAuthTokenRestore = discoverGranulesRewire.__set__('getAuthToken', async () => 'dummyToken');
    const actual = await filterDuplicateGranules(t.context.filesByGranuleId, 'skip', {});
    delete t.context.filesByGranuleId.duplicate;

    checkDuplicateRestore();
    getAuthTokenRestore();

    t.deepEqual(actual, t.context.filesByGranuleId);
  });

test('filterDuplicateGranules throws Error on duplicateHandling set to "error"',
  async (t) => {
    const filesByGranuleId = {
      duplicate: {},
      notDuplicate: {},
      someOtherGranule: {}
    };
    const filterDuplicateGranules = discoverGranulesRewire.__get__('filterDuplicateGranules');
    const checkDuplicateRestore = discoverGranulesRewire.__set__('checkDuplicate', checkDuplicateRewire);
    const getAuthTokenRestore = discoverGranulesRewire.__set__('getAuthToken', async () => 'dummyToken');

    await t.throwsAsync(
      () => filterDuplicateGranules(filesByGranuleId, 'error', {})
    );

    checkDuplicateRestore();
    getAuthTokenRestore();
  });

test('filterDuplicateGranules does not filter when duplicateHandling is set to "replace"',
  async (t) => {
    const filterDuplicateGranules = discoverGranulesRewire.__get__('filterDuplicateGranules');
    const checkDuplicateRestore = discoverGranulesRewire.__set__('checkDuplicate', checkDuplicateRewire);
    const getAuthTokenRestore = discoverGranulesRewire.__set__('getAuthToken', async () => 'dummyToken');

    const replaceActual = await filterDuplicateGranules(t.context.filesByGranuleId, 'replace', {});
    const versionActual = await filterDuplicateGranules(t.context.filesByGranuleId, 'version', {});

    checkDuplicateRestore();
    getAuthTokenRestore();

    t.deepEqual(replaceActual, t.context.filesByGranuleId);
    t.deepEqual(versionActual, t.context.filesByGranuleId);
  });


test('filterDuplicates returns a set of filtered keys',
  async (t) => {
    const filterDuplicates = discoverGranulesRewire.__get__('filterDuplicates');
    const getAuthTokenRestore = discoverGranulesRewire.__set__('getAuthToken', async () => 'dummyToken');
    const checkDuplicateRestore = discoverGranulesRewire.__set__('checkDuplicate', async (key) => {
      if (key === 'duplicate') {
        return '';
      }
      return key;
    });

    const actual = await filterDuplicates(['duplicate', 'key1', 'key2'], 'bogusHandlingValue');

    getAuthTokenRestore();
    checkDuplicateRestore();

    t.deepEqual(actual, ['key1', 'key2']);
  });

test('checkDuplicate returns an empty string when API returns a granule',
  async (t) => {
    const checkDuplicate = discoverGranulesRewire.__get__('checkDuplicate');
    // TODO better naming convention than restore
    const gotRestore = discoverGranulesRewire.__set__('got', { get: () => 'dummy value' });
    const actual = await checkDuplicate('granuleId', { token: 'dummyToken' }, 'baseUrl');

    gotRestore();

    t.is(actual, '');
  });


test('checkDuplicate returns a granuleId string when the API returns a 404/Not Found error',
  async (t) => {
    const checkDuplicate = discoverGranulesRewire.__get__('checkDuplicate');

    const error = new Error();
    error.statusCode = 404;
    error.statusMessage = 'Not Found';
    const gotRestore = discoverGranulesRewire.__set__('got', { get: () => { throw error } });

    const actual = await checkDuplicate('granuleId', { token: 'dummyToken' }, 'baseUrl');

    gotRestore();

    t.is(actual, 'granuleId');
  });

test('checkDuplicate throws an error if the API throws an error other than 404/Not Found',
  async (t) => {
    const checkDuplicate = discoverGranulesRewire.__get__('checkDuplicate');

    const error = new Error();
    error.statusCode = 500;
    error.statusMessage = 'Internal Server Error';
    const gotRestore = discoverGranulesRewire.__set__('got', { get: () => { throw error } });

    await t.throwsAsync(() => checkDuplicate('granuleId', { token: 'dummyToken' }, 'baseUrl'));

    gotRestore();
  });
