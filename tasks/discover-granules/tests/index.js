'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const rewire = require('rewire');
const sinon = require('sinon');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const {
  randomString,
  validateConfig,
  validateOutput
} = require('@cumulus/common/test-utils');
const Logger = require('@cumulus/logger');
const { promisify } = require('util');

const discoverGranulesRewire = rewire('..');
const discoverGranules = discoverGranulesRewire.discoverGranules;

const readFile = promisify(fs.readFile);

const checkGranuleHasNoDuplicateRewire = (granuleId, duplicateHandling, _) => {
  if (granuleId === 'duplicate') {
    if (duplicateHandling === 'error') {
      throw new Error(`Duplicate GranuleID ${granuleId} encountered in DiscoverGranules with duplicateHandling set to 'error'`);
    }
    return false;
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
  process.env.oauth_provider = 'earthdata';
  const eventPath = path.join(__dirname, 'fixtures', 'mur.json');
  const rawEvent = await readFile(eventPath, 'utf8');
  t.context.event = JSON.parse(rawEvent);
  t.context.filesByGranuleId = {
    duplicate: {},
    notDuplicate: {},
    someOtherGranule: {}
  };
});

test.afterEach(() => {
  delete process.env.GRANULES;
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

  const output = await discoverGranules(event);
  await assertDiscoveredGranules(t, output);

  output.granules.forEach((granule) => {
    t.is(granule.dataType, event.config.collection.name);
  });
});

test('discover granules using FTP', async (t) => {
  const { event } = t.context;

  event.config.collection.provider_path = 'granules/^fake_granules$';
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

  event.config.collection.provider_path = 'granules/^fake_granules$';
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

test.serial('handleDuplicates filters on duplicateHandling set to "skip"',
  async (t) => {
    let checkGranuleHasNoDuplicateRevert;
    try {
      const handleDuplicates = discoverGranulesRewire.__get__('handleDuplicates');
      checkGranuleHasNoDuplicateRevert = discoverGranulesRewire.__set__('checkGranuleHasNoDuplicate', checkGranuleHasNoDuplicateRewire);
      const actual = await handleDuplicates(t.context.filesByGranuleId, 'skip');
      delete t.context.filesByGranuleId.duplicate;
      t.deepEqual(actual, t.context.filesByGranuleId);
    } finally {
      checkGranuleHasNoDuplicateRevert();
    }
  });

test.serial('handleDuplicates throws Error on duplicateHandling set to "error"',
  async (t) => {
    let checkGranuleHasNoDuplicateRevert;
    try {
      const handleDuplicates = discoverGranulesRewire.__get__('handleDuplicates');
      checkGranuleHasNoDuplicateRevert = discoverGranulesRewire.__set__('checkGranuleHasNoDuplicate', checkGranuleHasNoDuplicateRewire);
      await t.throwsAsync(
        () => handleDuplicates(t.context.filesByGranuleId, 'error')
      );
    } finally {
      checkGranuleHasNoDuplicateRevert();
    }
  });

test('handleDuplicates throws Error on an invalid duplicateHandling configuration',
  async (t) => {
    const handleDuplicates = discoverGranulesRewire.__get__('handleDuplicates');
    await t.throwsAsync(
      () => handleDuplicates(t.context.filesByGranuleId, 'foobar')
    );
  });

test.serial('handleDuplicates does not filter when duplicateHandling is set to "replace" or "version"',
  async (t) => {
    let checkGranuleHasNoDuplicateRevert;
    try {
      const handleDuplicates = discoverGranulesRewire.__get__('handleDuplicates');
      checkGranuleHasNoDuplicateRevert = discoverGranulesRewire.__set__('checkGranuleHasNoDuplicate', checkGranuleHasNoDuplicateRewire);
      const replaceActual = await handleDuplicates(t.context.filesByGranuleId, 'replace');
      const versionActual = await handleDuplicates(t.context.filesByGranuleId, 'version');
      t.deepEqual(replaceActual, t.context.filesByGranuleId);
      t.deepEqual(versionActual, t.context.filesByGranuleId);
    } finally {
      checkGranuleHasNoDuplicateRevert();
    }
  });


test.serial('filterDuplicates returns a set of filtered keys',
  async (t) => {
    let checkGranuleHasNoDuplicateRevert;
    try {
      const filterDuplicates = discoverGranulesRewire.__get__('filterDuplicates');
      checkGranuleHasNoDuplicateRevert = discoverGranulesRewire.__set__('checkGranuleHasNoDuplicate', async (key) => {
        if (key === 'duplicate') {
          return false;
        }
        return key;
      });

      const actual = await filterDuplicates(['duplicate', 'key1', 'key2'], 'bogusHandlingValue');
      t.deepEqual(actual, ['key1', 'key2']);
    } finally {
      checkGranuleHasNoDuplicateRevert();
    }
  });

test.serial('checkGranuleHasNoDuplicate returns false when API lambda returns a granule',
  async (t) => {
    let granulesRevert;
    try {
      const checkGranuleHasNoDuplicate = discoverGranulesRewire.__get__('checkGranuleHasNoDuplicate');
      granulesRevert = discoverGranulesRewire.__set__('granules', {
        getGranule: async () => ({ statusCode: 200, body: '{}' })
      });
      const actual = await checkGranuleHasNoDuplicate('granuleId', '');
      t.false(actual);
    } finally {
      granulesRevert();
    }
  });

test.serial('checkGranuleHasNoDuplicate throws an error when API lambda returns a granule and duplicateHandling is set to "error"',
  async (t) => {
    let granulesRevert;
    try {
      const checkGranuleHasNoDuplicate = discoverGranulesRewire.__get__('checkGranuleHasNoDuplicate');
      granulesRevert = discoverGranulesRewire.__set__('granules', {
        getGranule: async () => ({ statusCode: 200, body: '{}' })
      });
      await t.throwsAsync(checkGranuleHasNoDuplicate('granuleId', 'error'));
    } finally {
      granulesRevert();
    }
  });

test.serial('checkGranuleHasNoDuplicate returns a granuleId string when the API lambda returns a 404/Not Found error',
  async (t) => {
    let granulesRevert;
    try {
      const checkGranuleHasNoDuplicate = discoverGranulesRewire.__get__('checkGranuleHasNoDuplicate');
      granulesRevert = discoverGranulesRewire.__set__('granules', {
        getGranule: async () => ({ statusCode: 404, body: '{"error": "Not Found"}' })
      });
      const actual = await checkGranuleHasNoDuplicate('granuleId', '');
      t.is(actual, 'granuleId');
    } finally {
      granulesRevert();
    }
  });

test.serial('checkGranuleHasNoDuplicate throws an error if the API lambda throws an error other than 404/Not Found',
  async (t) => {
    let granulesRevert;
    try {
      const checkGranuleHasNoDuplicate = discoverGranulesRewire.__get__('checkGranuleHasNoDuplicate');
      granulesRevert = discoverGranulesRewire.__set__('granules', {
        getGranule: async () => {
          throw new Error('Test Error');
        }
      });
      await t.throwsAsync(() => checkGranuleHasNoDuplicate('granuleId', ''));
    } finally {
      granulesRevert();
    }
  });

test.serial('checkGranuleHasNoDuplicate throws an error on an unexpected API lambda return',
  async (t) => {
    let granulesRevert;
    try {
      const checkGranuleHasNoDuplicate = discoverGranulesRewire.__get__('checkGranuleHasNoDuplicate');
      granulesRevert = discoverGranulesRewire.__set__('granules', {
        getGranule: async () => ({ body: '{"statusCode": 500}' })
      });
      await t.throwsAsync(() => checkGranuleHasNoDuplicate('granuleId', ''));
    } finally {
      granulesRevert();
    }
  });

test('discover granules sets the GRANULES environment variable and logs the granules', async (t) => {
    const { event } = t.context;

    event.config.collection.provider_path = '/granules/fake_granules';
    event.config.provider = {
      id: 'MODAPS',
      protocol: 'http',
      host: '127.0.0.1',
      port: 3030
    };

    t.falsy(process.env.GRANULES);

    const loggerInfoSpy = sinon.spy(Logger.prototype, 'info');

    try {
      await validateConfig(t, event.config);

      await discoverGranules(event);

      t.truthy(process.env.GRANULES);

      const granules = JSON.parse(process.env.GRANULES);
      t.deepEqual(granules, [
        'granule-1',
        'granule-2',
        'granule-3'
      ]);

      // Check that the second log.info() call had the granules set
      const loggerCall = loggerInfoSpy.getCall(1);
      t.deepEqual(loggerCall.thisValue.granules[
        'granule-1',
        'granule-2',
        'granule-3'
      ]);
    }
    finally {
      loggerInfoSpy.restore();
    }
  });
