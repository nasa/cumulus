'use strict';

const path = require('path');
const test = require('ava');
const sinon = require('sinon');
const pMap = require('p-map');
const proxyquire = require('proxyquire');
const { readJson } = require('fs-extra');
const { CumulusApiClientError } = require('@cumulus/api-client/CumulusApiClientError');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const {
  randomString,
  validateConfig,
  validateOutput,
} = require('@cumulus/common/test-utils');
const Logger = require('@cumulus/logger');

// This creates a fake logger which saves its log entries out to the `logEvents` array, rather than
// printing them out to the console. This allows us to test that an expected log event is written
// in one of the tests.
let logEvents = [];

const fakeConsole = {
  log(message) {
    logEvents.push(JSON.parse(message));
  },
};

class FakeLogger extends Logger {
  constructor(options = {}) {
    super({ ...options, console: fakeConsole });
  }
}

// This fakes the `@cumulus/api-client/granules` module so that we can simulate responses from the
// Cumulus API in our tests. It returns different canned responses depending on the `granuleId`.
const fakeGranulesModule = {
  getGranuleResponse: ({ granuleId }) => {
    if (granuleId === 'duplicate') {
      return Promise.resolve({
        statusCode: 200,
        body: '{"status": "completed"}',
      });
    }

    if (granuleId === 'queued') {
      return Promise.resolve({
        statusCode: 200,
        body: '{"status": "queued"}',
      });
    }

    if (granuleId === 'throw-error') {
      throw new CumulusApiClientError('Test Error');
    }

    if (granuleId === 'unexpected-response') {
      return Promise.resolve({
        statusCode: 201,
        body: '{}',
      });
    }

    throw new CumulusApiClientError(
      'API error',
      404,
      'Not Found'
    );
  },
};

const pMapSpy = sinon.spy(pMap);

// Import the discover-granules functions that we'll be testing, configuring them to use the fake
// granules module and the fake logger.
const {
  checkGranuleHasNoDuplicate,
  discoverGranules,
  filterDuplicates,
  handleDuplicates,
} = proxyquire(
  '..',
  {
    'p-map': pMapSpy,
    '@cumulus/api-client/granules': fakeGranulesModule,
    '@cumulus/logger': FakeLogger,
  }
);

async function assertDiscoveredGranules(t, output) {
  await validateOutput(t, output);
  t.is(output.granules.length, 3);
  output.granules.forEach(({ files }) => t.is(files.length, 2));
  t.truthy(['data', 'metadata'].includes(output.granules[0].files[0].type));
}

test.beforeEach(async (t) => {
  pMapSpy.resetHistory();
  process.env.oauth_provider = 'earthdata';

  t.context.event = await readJson(path.join(__dirname, 'fixtures', 'mur.json'));

  t.context.filesByGranuleId = {
    duplicate: {},
    notDuplicate: {},
    someOtherGranule: {},
  };
});

test('discover granules sets the correct dataType for granules', async (t) => {
  const { event } = t.context;

  event.config.provider_path = '/granules/fake_granules';

  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
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

  event.config.provider_path = 'granules/^fake_granules$';

  event.config.useList = true;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
  };

  await validateConfig(t, event.config);

  await assertDiscoveredGranules(t, await discoverGranules(event));
});

test('discover granules using SFTP', async (t) => {
  const { event } = t.context;

  event.config.provider_path = 'granules/^fake_granules$';

  event.config.provider = {
    id: 'MODAPS',
    protocol: 'sftp',
    host: '127.0.0.1',
    port: 2222,
    username: 'user',
    password: 'password',
  };

  await validateConfig(t, event.config);

  await assertDiscoveredGranules(t, await discoverGranules(event));
});

test('discover granules using HTTP', async (t) => {
  const { event } = t.context;

  event.config.provider_path = '/granules/fake_granules';

  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };

  await validateConfig(t, event.config);

  await assertDiscoveredGranules(t, await discoverGranules(event));
});

const discoverGranulesUsingS3 = (configure, assert = assertDiscoveredGranules) =>
  async (t) => {
    const { event, event: { config } } = t.context;
    // State sample files
    const files = [
      'granule-1.nc', 'granule-1.nc.md5',
      'granule-2.nc', 'granule-2.nc.md5',
      'granule-3.nc', 'granule-3.nc.md5',
    ];

    config.sourceBucketName = randomString();
    event.config.provider_path = randomString();

    configure(t);

    await validateConfig(t, config);
    await s3().createBucket({ Bucket: config.sourceBucketName });

    try {
      await Promise.all(files.map((file) =>
        s3().putObject({
          Bucket: config.sourceBucketName,
          Key: `${event.config.provider_path}/${file}`,
          Body: `This is ${file}`,
        })));
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
      host: config.sourceBucketName,
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
      host: config.sourceBucketName,
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
      host: config.sourceBucketName,
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
      host: config.sourceBucketName,
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
      host: config.sourceBucketName,
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
      host: config.sourceBucketName,
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
        host: randomString(),
      };
    });
    await t.throwsAsync(assert(t), { name: 'NoSuchBucket' });
  });

test('handleDuplicates filters on duplicateHandling set to "skip"', async (t) => {
  const result = await handleDuplicates({
    filesByGranuleId: t.context.filesByGranuleId,
    duplicateHandling: 'skip',
  });

  t.is(Object.keys(result).length, 2);
  t.is(result.duplicate, undefined);
});

test(
  'handleDuplicates throws Error on duplicateHandling set to "error"',
  (t) => t.throwsAsync(handleDuplicates({
    filesByGranuleId: t.context.filesByGranuleId,
    duplicateHandling: 'error',
  }))
);

test(
  'handleDuplicates throws Error on an invalid duplicateHandling configuration',
  (t) => t.throwsAsync(handleDuplicates({
    filesByGranuleId: t.context.filesByGranuleId,
    duplicateHandling: 'foobar',
  }))
);

test('handleDuplicates does not filter when duplicateHandling is set to "replace"', async (t) => {
  t.deepEqual(
    await handleDuplicates({
      filesByGranuleId: t.context.filesByGranuleId,
      duplicateHandling: 'replace',
    }),
    t.context.filesByGranuleId
  );
});

test('handleDuplicates does not filter when duplicateHandling is set to "version"', async (t) => {
  t.deepEqual(
    await handleDuplicates({
      filesByGranuleId: t.context.filesByGranuleId,
      duplicateHandling: 'version',
    }),
    t.context.filesByGranuleId
  );
});

test('filterDuplicates returns a set of filtered keys', async (t) => {
  t.deepEqual(
    await filterDuplicates({
      granuleIds: ['duplicate', 'queued', 'key1', 'key2'],
      duplicateHandling: 'skip',
    }),
    ['key1', 'key2']
  );
});

test('checkGranuleHasNoDuplicate returns false when API lambda returns a granule', async (t) => {
  t.false(await checkGranuleHasNoDuplicate('duplicate', 'replace'));
});

test(
  'checkGranuleHasNoDuplicate throws an error when API lambda returns a granule and duplicateHandling is set to "error"',
  (t) => t.throwsAsync(checkGranuleHasNoDuplicate('duplicate', 'error'))
);

test('checkGranuleHasNoDuplicate returns a granuleId string when the API lambda returns a 404/Not Found error', async (t) => {
  t.is(
    await checkGranuleHasNoDuplicate('granuleId', 'skip'),
    'granuleId'
  );
});

test(
  'checkGranuleHasNoDuplicate throws an error if the API lambda throws an error other than 404/Not Found',
  (t) => t.throwsAsync(
    checkGranuleHasNoDuplicate('throw-error', 'skip'),
    { message: /Test Error/ }
  )
);

test('checkGranuleHasNoDuplicate throws an error on an unexpected API lambda return', async (t) => {
  const error = await t.throwsAsync(checkGranuleHasNoDuplicate('unexpected-response', 'skip'));
  t.true(error.message.startsWith('Unexpected return from Private API lambda'));
});

test('checkGranuleHasNoDuplicate does not enter a retry loop when a granule exists and duplicateHandling is set to skip',
  async (t) => {
    t.notThrowsAsync(checkGranuleHasNoDuplicate('duplicate', 'skip'));
    t.false(await (checkGranuleHasNoDuplicate('duplicate', 'skip')));
  });

test('checkGranuleHasNoDuplicate does not enter a retry loop when a granule exists and duplicateHandling is set to error',
  async (t) => {
    const error = await t.throwsAsync(checkGranuleHasNoDuplicate('duplicate', 'error'));
    t.false(error.message.includes('Attempt 3 failed'));
  });

test.serial('discover granules uses default concurrency of 3', async (t) => {
  const { event } = t.context;

  event.config.provider_path = '/granules/fake_granules';

  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };
  event.config.duplicateGranuleHandling = 'skip';

  await validateConfig(t, event.config);

  await discoverGranules(event);

  t.true(pMapSpy.calledOnce);
  t.true(pMapSpy.calledWithMatch(
    sinon.match.any,
    sinon.match.any,
    sinon.match({ concurrency: 3 })
  ));
});

test.serial('discover granules uses configured concurrency', async (t) => {
  const { event } = t.context;

  event.config.provider_path = '/granules/fake_granules';

  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };

  event.config.duplicateGranuleHandling = 'skip';
  event.config.concurrency = 17;

  await validateConfig(t, event.config);

  await discoverGranules(event);

  t.true(pMapSpy.calledOnce);
  t.true(pMapSpy.calledWithMatch(
    sinon.match.any,
    sinon.match.any,
    sinon.match({ concurrency: 17 })
  ));
});

test.serial('discover granules sets the GRANULES environment variable and logs the granules', async (t) => {
  const { event } = t.context;

  event.config.provider_path = '/granules/fake_granules';

  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };

  // Empty out the list of log events
  logEvents = [];

  try {
    await discoverGranules(event);
  } finally {
    delete process.env.GRANULES;
  }

  const logEventWithGranules = logEvents
    .find(({ message }) => message === 'Discovered 3 granules.');

  t.deepEqual(
    logEventWithGranules.granules,
    ['granule-1', 'granule-2', 'granule-3']
  );
});
