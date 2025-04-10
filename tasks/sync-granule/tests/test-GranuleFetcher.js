'use strict';

const path = require('path');
const test = require('ava');
const S3 = require('@cumulus/aws-client/S3');
const ingestPayload = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');
const { s3 } = require('@cumulus/aws-client/services');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const errors = require('@cumulus/errors');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  collectionVersionFrom,
  collectionNameFrom,
  GranuleFetcher,
} = require('../GranuleFetcher');

const sums = require('./fixtures/sums');

test.before((t) => {
  t.context.collectionConfig = {
    name: 'testDataType',
    version: 'testVersion',
    files: [
      {
        regex: '^[A-Z]|[a-z]+\.txt',
      },
    ],
  };
});

test.beforeEach(async (t) => {
  t.context.internalBucket = randomId('internal-bucket');
  t.context.destBucket = randomId('dest-bucket');
  await Promise.all([
    s3().createBucket({ Bucket: t.context.internalBucket }),
    s3().createBucket({ Bucket: t.context.destBucket }),
  ]);
});

test.afterEach(async (t) => {
  await Promise.all([
    S3.recursivelyDeleteS3Bucket(t.context.internalBucket),
    S3.recursivelyDeleteS3Bucket(t.context.destBucket),
  ]);
});

/**
* test the granule.verifyFile() method
**/

Object.keys(sums).forEach((key) => {
  test(`granule.verifyFile ${key}`, async (t) => {
    const granuleFetcher = new GranuleFetcher(ingestPayload.config);
    const filepath = path.join(__dirname, 'fixtures', `${key}.txt`);
    await S3.putFile(t.context.internalBucket, key, filepath);

    const file = { checksumType: key, checksum: sums[key] };

    await t.notThrowsAsync(
      async () => {
        await granuleFetcher.verifyFile(file, t.context.internalBucket, key);
        await granuleFetcher.verifyFile(key, t.context.internalBucket, key);
      }
    );
  });
});

test('findCollectionFileConfigForFile returns the correct config', (t) => {
  const rightCollectionFileConfig = { regex: '^right-.*', bucket: 'right-bucket' };
  const wrongCollectionFileConfig = { regex: '^wrong-.*', bucket: 'wrong-bucket' };
  const collectionConfig = {
    files: [rightCollectionFileConfig, wrongCollectionFileConfig],
  };

  const testGranule = new GranuleFetcher({
    collection: collectionConfig,
    provider: { protocol: 's3', host: 'some-bucket' },
  });

  const file = { name: 'right-file' };
  const fileCollectionConfig = testGranule.findCollectionFileConfigForFile(file);

  t.deepEqual(fileCollectionConfig, rightCollectionFileConfig);
});

test('findCollectionFileConfigForFile returns undefined if no config matches', (t) => {
  const wrongCollectionFileConfig = { regex: '^wrong-.*', bucket: 'wrong-bucket' };
  const collectionConfig = {
    files: [wrongCollectionFileConfig],
  };

  const testGranule = new GranuleFetcher({
    collection: collectionConfig,
    provider: { protocol: 's3', host: 'some-bucket' },
  });

  const file = { name: 'right-file' };
  const fileCollectionConfig = testGranule.findCollectionFileConfigForFile(file);

  t.is(fileCollectionConfig, undefined);
});

test('ingestFile keeps both new and old data when duplicateHandling is version', async (t) => {
  const { collectionConfig, destBucket, internalBucket } = t.context;

  const file = {
    path: randomString(),
    name: 'test.txt',
  };
  const key = S3.s3Join(file.path, file.name);
  const params = { Bucket: internalBucket, Key: key, Body: randomString() };
  await S3.s3PutObject(params);

  const duplicateHandling = 'version';
  // leading '/' should be trimmed
  const fileStagingDir = '/file-staging';
  const testGranule = new GranuleFetcher({
    collection: collectionConfig,
    provider: { protocol: 's3', host: internalBucket },
    fileStagingDir,
    duplicateHandling,
  });

  const {
    files: oldfiles,
    duplicate: initialDuplicate,
  } = await testGranule._ingestFile({
    file,
    destinationBucket: destBucket,
    duplicateHandling,
    collectionId: constructCollectionId(collectionConfig.name, collectionConfig.version),
  });
  t.is(oldfiles.length, 1);
  t.is(initialDuplicate, undefined);

  // update the source file with different content and ingest again
  params.Body = randomString();
  await S3.s3PutObject(params);
  const {
    files: newfiles,
    duplicate: finalDuplicate,
  } = await testGranule._ingestFile({
    file,
    destinationBucket: destBucket,
    duplicateHandling,
    collectionId: constructCollectionId(collectionConfig.name, collectionConfig.version),
  });
  t.is(newfiles.length, 2);
  t.deepEqual(
    finalDuplicate,
    {
      bucket: destBucket,
      key: S3.s3Join(
        fileStagingDir,
        constructCollectionId(collectionConfig.name, collectionConfig.version),
        file.name
      ),
    }
  );
});

test('ingestFile throws error when configured to handle duplicates with error', async (t) => {
  const { collectionConfig, destBucket, internalBucket } = t.context;

  const file = {
    path: '',
    name: 'test.txt',
  };

  const Key = S3.s3Join(file.path, file.name);
  const params = { Bucket: internalBucket, Key, Body: 'test' };
  await S3.s3PutObject(params);

  const duplicateHandling = 'error';
  const fileStagingDir = 'file-staging';
  const testGranule = new GranuleFetcher({
    collection: collectionConfig,
    provider: { protocol: 's3', host: internalBucket },
    fileStagingDir,
    duplicateHandling,
  });

  // This test needs to use a unique bucket for each test (or remove the object
  // added to the destination bucket). Otherwise, it will throw an error on the
  // first attempt to ingest the file.
  await testGranule._ingestFile({
    file,
    destinationBucket: destBucket,
    duplicateHandling,
    collectionId: constructCollectionId(collectionConfig.name, collectionConfig.version),
  });
  const destFileKey = S3.s3Join(fileStagingDir, testGranule.collectionId, file.name);

  await t.throwsAsync(
    () => testGranule._ingestFile({
      file,
      destinationBucket: destBucket,
      duplicateHandling,
      collectionId: constructCollectionId(collectionConfig.name, collectionConfig.version),
    }),
    {
      instanceOf: errors.DuplicateFile,
      message: `${destFileKey} already exists in ${destBucket} bucket`,
    }
  );
});

test('ingestFile skips ingest when duplicateHandling is skip', async (t) => {
  const { collectionConfig, destBucket, internalBucket } = t.context;

  const file = {
    path: randomString(),
    name: 'test.txt',
  };
  const key = S3.s3Join(file.path, file.name);
  const params = { Bucket: internalBucket, Key: key, Body: randomString(30) };
  await S3.s3PutObject(params);

  const duplicateHandling = 'skip';
  const fileStagingDir = 'file-staging';
  const testGranule = new GranuleFetcher({
    collection: collectionConfig,
    provider: { protocol: 's3', host: internalBucket },
    fileStagingDir,
    duplicateHandling,
  });

  const {
    files: oldfiles,
    duplicate: initialDuplicate,
  } = await testGranule._ingestFile({
    file,
    destinationBucket: destBucket,
    duplicateHandling,
    collectionId: constructCollectionId(collectionConfig.name, collectionConfig.version),
  });
  t.is(oldfiles.length, 1);
  t.is(initialDuplicate, undefined);
  t.is(oldfiles[0].size, params.Body.length);

  // update the source file with different content and ingest again
  params.Body = randomString(100);
  await S3.s3PutObject(params);
  const {
    files: newfiles,
    duplicate: finalDuplicate,
  } = await testGranule._ingestFile({
    file,
    destinationBucket: destBucket,
    duplicateHandling,
    collectionId: constructCollectionId(collectionConfig.name, collectionConfig.version),
  });
  t.is(newfiles.length, 1);
  t.not(finalDuplicate, undefined);
  t.is(newfiles[0].size, oldfiles[0].size);
  t.not(newfiles[0].size, params.Body.length);
});

test('ingestFile replaces file when duplicateHandling is replace', async (t) => {
  const { collectionConfig, destBucket, internalBucket } = t.context;

  const file = {
    path: randomString(),
    name: 'test.txt',
  };
  const key = S3.s3Join(file.path, file.name);
  const params = { Bucket: internalBucket, Key: key, Body: randomString(30) };
  await S3.s3PutObject(params);

  const duplicateHandling = 'replace';
  const fileStagingDir = 'file-staging';
  const testGranule = new GranuleFetcher({
    collection: collectionConfig,
    provider: { protocol: 's3', host: internalBucket },
    fileStagingDir,
    duplicateHandling,
  });

  const { files: oldfiles, duplicate: initialDuplicate }
    = await testGranule._ingestFile({
      file,
      destinationBucket: destBucket,
      duplicateHandling,
      collectionId: constructCollectionId(collectionConfig.name, collectionConfig.version),
    });
  t.is(oldfiles.length, 1);
  t.is(initialDuplicate, undefined);
  t.is(oldfiles[0].size, params.Body.length);

  // update the source file with different content and ingest again
  params.Body = randomString(100);
  await S3.s3PutObject(params);
  const {
    files: newfiles,
    duplicate: finalDuplicate,
  } = await testGranule._ingestFile({
    file,
    destinationBucket: destBucket,
    duplicateHandling,
    collectionId: constructCollectionId(collectionConfig.name, collectionConfig.version),
  });
  t.is(newfiles.length, 1);
  t.not(finalDuplicate, undefined);
  t.not(newfiles[0].size, oldfiles[0].size);
  t.is(newfiles[0].size, params.Body.length);
});

test('ingestFile throws an error when invalid checksum is provided', async (t) => {
  const { collectionConfig, destBucket, internalBucket } = t.context;

  const file = {
    path: '',
    name: 'test.txt',
    checksumType: 'md5',
    checksum: 'badchecksum',
  };

  const Key = S3.s3Join(file.path, file.name);
  const params = { Bucket: internalBucket, Key, Body: randomString(30) };
  await S3.s3PutObject(params);

  const duplicateHandling = 'replace';
  const fileStagingDir = 'file-staging';
  const testGranule = new GranuleFetcher({
    collection: collectionConfig,
    provider: { protocol: 's3', host: internalBucket },
    fileStagingDir,
    duplicateHandling,
  });

  const stagingPath = S3.s3Join(testGranule.fileStagingDir, testGranule.collectionId);
  // This test needs to use a unique bucket for each test (or remove the object
  // added to the destination bucket). Otherwise, it will throw an error on the
  // first attempt to ingest the file.

  await t.throwsAsync(
    () => testGranule._ingestFile({
      file,
      destinationBucket: destBucket,
      duplicateHandling,
      collectionId: constructCollectionId(collectionConfig.name, collectionConfig.version),
    }),
    {
      instanceOf: errors.InvalidChecksum,
      message: `Invalid checksum for S3 object s3://${destBucket}/${stagingPath}/${file.name} with type ${file.checksumType} and expected sum ${file.checksum}`,
    }
  );
});

test('ingestFile throws an error when no checksum is provided and the size is not as expected', async (t) => {
  const { collectionConfig, destBucket, internalBucket } = t.context;

  const file = {
    path: '',
    name: 'test.txt',
    size: 123456789,
  };

  const Key = S3.s3Join(file.path, file.name);
  const params = { Bucket: internalBucket, Key, Body: randomString(30) };
  await S3.s3PutObject(params);

  const duplicateHandling = 'replace';
  const fileStagingDir = 'file-staging';
  const testGranule = new GranuleFetcher({
    collection: collectionConfig,
    provider: { protocol: 's3', host: internalBucket },
    fileStagingDir,
    duplicateHandling,
  });

  // This test needs to use a unique bucket for each test (or remove the object
  // added to the destination bucket). Otherwise, it will throw an error on the
  // first attempt to ingest the file.
  await t.throwsAsync(
    () => testGranule._ingestFile({
      file,
      destinationBucket: destBucket,
      duplicateHandling,
      collectionId: constructCollectionId(collectionConfig.name, collectionConfig.version),
    }),
    {
      instanceOf: errors.UnexpectedFileSize,
      message: `verifyFile ${file.name} failed: Actual file size ${params.Body.length} did not match expected file size ${file.size}`,
    }
  );
});

test('verifyFile returns type and value when file is verified', async (t) => {
  const { collectionConfig, internalBucket } = t.context;

  const content = 'test-string';

  const file = {
    path: '',
    name: 'test.txt',
    checksumType: 'md5',
    checksum: '661f8009fa8e56a9d0e94a0a644397d7',
    size: content.length,
  };

  const Key = S3.s3Join(file.path, file.name);
  const params = { Bucket: internalBucket, Key, Body: content };
  await S3.s3PutObject(params);

  const duplicateHandling = 'replace';
  const fileStagingDir = 'file-staging';
  const testGranule = new GranuleFetcher({
    collection: collectionConfig,
    provider: { protocol: 's3', host: internalBucket },
    fileStagingDir,
    duplicateHandling,
  });

  const [type, value] = await testGranule.verifyFile(file, internalBucket, Key);
  t.is(type, file.checksumType);
  t.is(value, file.checksum);
});

test("getUrlPath() returns the collection's url_path if there are no matching collection file configs", (t) => {
  const provider = { protocol: 's3', host: 'some-bucket' };

  const collectionConfig = {
    url_path: 'collection-url-path',
    files: [],
  };

  const granuleFetcher = new GranuleFetcher({
    collection: collectionConfig,
    provider,
  });

  const file = { name: 'asdf' };

  t.is(granuleFetcher.getUrlPath(file), 'collection-url-path');
});

test("getUrlPath() returns the collection file config's url_path if there is one", (t) => {
  const provider = { protocol: 's3', host: 'some-bucket' };

  const collectionConfig = {
    url_path: 'collection-url-path',
    files: [{
      regex: /sd/,
      url_path: 'file-url-path',
    }],
  };

  const granuleFetcher = new GranuleFetcher({
    collection: collectionConfig,
    provider,
  });

  const file = { name: 'asdf' };

  t.is(granuleFetcher.getUrlPath(file), 'file-url-path');
});

test("getUrlPath() returns the collection's url_path if there is a matching collection file config that does not have a url_path", (t) => {
  const provider = { protocol: 's3', host: 'some-bucket' };

  const collectionConfig = {
    url_path: 'collection-url-path',
    files: [{
      regex: /sd/,
    }],
  };

  const granuleFetcher = new GranuleFetcher({
    collection: collectionConfig,
    provider,
  });

  const file = { name: 'asdf' };

  t.is(granuleFetcher.getUrlPath(file), 'collection-url-path');
});

test('addChecksumsToFiles adds checksums correctly if checksumFor is defined', async (t) => {
  const { internalBucket } = t.context;
  const provider = { protocol: 's3', host: internalBucket };

  const dataFileRegex = '.*\.hdf';
  const collectionConfig = {
    name: 'testName',
    version: 'testVersion',
    files: [{
      regex: dataFileRegex,
    },
    {
      regex: '.*\.md5',
      checksumFor: dataFileRegex,
    }],
  };

  const fetcher = new GranuleFetcher({
    collection: collectionConfig,
    provider,
  });

  const dataFile = {
    name: 'dataFile.hdf',
    path: '',
  };
  const checksumFile = {
    name: 'dataChecksum.md5',
    path: '',
  };

  const files = [dataFile, checksumFile];

  const fakeChecksum = 'abcd1234';
  const Key = S3.s3Join(checksumFile.name);
  const params = { Bucket: internalBucket, Key, Body: fakeChecksum };
  await S3.s3PutObject(params);

  const filesWithChecksums = await fetcher.addChecksumsToFiles(files);
  t.deepEqual(
    filesWithChecksums.find((file) => file.name === dataFile.name),
    {
      ...dataFile,
      checksumType: 'md5',
      checksum: fakeChecksum,
    }
  );
});

test('addChecksumsToFiles falls back to dataFileExt.checksumExt assumption if checksumFor is not defined', async (t) => {
  const { internalBucket } = t.context;
  const provider = { protocol: 's3', host: internalBucket };

  const dataFileRegex = '.*\.hdf';
  const collectionConfig = {
    name: 'testName',
    version: 'testVersion',
    files: [{
      regex: dataFileRegex,
    },
    {
      regex: '.*\.md5',
    }],
  };

  const fetcher = new GranuleFetcher({
    collection: collectionConfig,
    provider,
  });

  const dataFile = {
    name: 'dataFile.hdf',
    path: '',
  };
  const checksumFile = {
    name: 'dataFile.hdf.md5',
    path: '',
  };

  const files = [dataFile, checksumFile];

  const fakeChecksum = 'abcd1234';
  const Key = S3.s3Join(checksumFile.name);
  const params = { Bucket: internalBucket, Key, Body: fakeChecksum };
  await S3.s3PutObject(params);

  const filesWithChecksums = await fetcher.addChecksumsToFiles(files);
  t.deepEqual(
    filesWithChecksums.find((file) => file.name === dataFile.name),
    {
      ...dataFile,
      checksumType: 'md5',
      checksum: fakeChecksum,
    }
  );
});

test('addChecksumsToFiles throws an error if no file matches the checksumFor config', async (t) => {
  const { internalBucket } = t.context;
  const provider = { protocol: 's3', host: internalBucket };

  const checksumFor = '.*\.nc';
  const collectionConfig = {
    name: 'testName',
    version: 'testVersion',
    files: [{
      regex: '.*\.hdf',
    },
    {
      regex: '.*\.md5',
      checksumFor,
    }],
  };

  const fetcher = new GranuleFetcher({
    collection: collectionConfig,
    provider,
  });

  const dataFile = {
    name: 'dataFile.hdf',
    path: '',
  };
  const checksumFile = {
    name: 'dataFile.md5',
    path: '',
  };

  const files = [dataFile, checksumFile];

  await t.throwsAsync(
    () => fetcher.addChecksumsToFiles(files),
    {
      instanceOf: errors.FileNotFound,
      message: `Could not find file to match ${checksumFile.name} checksumFor ${checksumFor}`,
    }
  );
});

test('collectionVersionFrom returns granuleVersion if it is defined', (t) => {
  const granuleVersion = 'v1';
  t.is(collectionVersionFrom({ version: granuleVersion }, { version: 'foobar' }), granuleVersion);
});

test('collectionVersionFrom returns collectionVersion if granuleVersion is not defined and collection version is defined', (t) => {
  const collectionVersion = 'v0';
  t.is(collectionVersionFrom(null, { version: collectionVersion }), collectionVersion);
});

test('collectionVersionFrom throws an error if neither granuleVersion nor collection version is defined', (t) => {
  t.throws(() => collectionVersionFrom());
});

test('collectionNameFrom returns granuleVersion if it is defined', (t) => {
  const collectionName = 'foobar';
  t.is(collectionNameFrom({ dataType: collectionName }, { name: 'foobar' }), collectionName);
});

test('collectionNameFrom returns collectionVersion if granuleVersion is not defined and collection version is defined', (t) => {
  const collectionName = 'foobar';
  t.is(collectionNameFrom(null, { name: collectionName }), collectionName);
});

test('collectionNameFrom throws an error if neither granuleVersion nor collection version is defined', (t) => {
  t.throws(() => collectionVersionFrom());
});
