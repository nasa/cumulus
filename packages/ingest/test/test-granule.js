const fs = require('fs-extra');
const moment = require('moment');
const path = require('path');

const test = require('ava');

const discoverPayload = require('@cumulus/test-data/payloads/new-message-schema/discover.json');
const ingestPayload = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const {
  buildS3Uri,
  s3,
  s3PutObject,
  recursivelyDeleteS3Bucket
} = require('@cumulus/common/aws');
const errors = require('@cumulus/common/errors');

const {
  selector,
  Granule,
  FtpGranule,
  SftpGranule,
  HttpGranule,
  S3Granule,
  FtpDiscoverGranules,
  HttpDiscoverGranules,
  SftpDiscoverGranules,
  S3DiscoverGranules,
  generateMoveFileParams,
  getRenamedS3File,
  moveGranuleFiles,
  moveGranuleFile,
  renameS3FileWithTimestamp,
  unversionFilename
} = require('../granule');

const { baseProtocol } = require('../protocol');
const { s3Mixin } = require('../s3');

test.beforeEach(async (t) => {
  t.context.internalBucket = randomId('internal-bucket');
  t.context.destBucket = randomId('dest-bucket');
  await Promise.all([
    s3().createBucket({ Bucket: t.context.internalBucket }).promise(),
    s3().createBucket({ Bucket: t.context.destBucket }).promise()
  ]);
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(t.context.internalBucket),
    recursivelyDeleteS3Bucket(t.context.destBucket)
  ]);
});
/**
* test that granule.selector() returns the correct class
**/

const selectorDiscoverTypes = [
  { cls: FtpDiscoverGranules, type: 'discover', protocol: 'ftp' },
  { cls: HttpDiscoverGranules, type: 'discover', protocol: 'http' },
  { cls: HttpDiscoverGranules, type: 'discover', protocol: 'https' },
  { cls: SftpDiscoverGranules, type: 'discover', protocol: 'sftp' },
  { cls: S3DiscoverGranules, type: 'discover', protocol: 's3' }
];

const selectorSyncTypes = [
  { cls: HttpGranule, type: 'ingest', protocol: 'http' },
  { cls: HttpGranule, type: 'ingest', protocol: 'https' },
  { cls: FtpGranule, type: 'ingest', protocol: 'ftp' },
  { cls: SftpGranule, type: 'ingest', protocol: 'sftp' },
  { cls: S3Granule, type: 'ingest', protocol: 's3' }
];

selectorDiscoverTypes.forEach((item) => {
  test(`test selector for discovery ${item.type}-${item.protocol}`, (t) => {
    const payload = item.type === 'ingest' ? ingestPayload : discoverPayload;
    const Cls = selector(item.type, item.protocol, item.queue);
    const instance = new Cls(payload);
    t.true(instance instanceof item.cls);
  });
});

selectorSyncTypes.forEach((item) => {
  test(`test selector for sync ${item.type}-${item.protocol}`, (t) => {
    const payload = item.type === 'ingest' ? ingestPayload : discoverPayload;
    const Cls = selector(item.type, item.protocol, item.queue);
    const instance = new Cls(
      payload.config.buckets,
      payload.config.collection,
      payload.config.provider
    );
    t.true(instance instanceof item.cls);
  });
});

/**
* test the granule.verifyFile() method
**/

const sums = require('./fixtures/sums');

Object.keys(sums).forEach((key) => {
  test(`granule.verifyFile ${key}`, async (t) => {
    const granule = new HttpGranule(
      ingestPayload.config.buckets,
      ingestPayload.config.collection,
      ingestPayload.config.provider
    );
    const filepath = path.join(__dirname, 'fixtures', `${key}.txt`);
    await s3PutObject({
      Bucket: t.context.internalBucket,
      Key: key,
      Body: fs.createReadStream(filepath)
    });

    try {
      const file = { checksumType: key, checksumValue: sums[key] };
      await granule.verifyFile(file, t.context.internalBucket, key);
      await granule.verifyFile(key, t.context.internalBucket, key);
      t.pass();
    } catch (e) {
      t.fail(e);
    }
  });
});

class TestGranule extends Granule {}

test('findCollectionFileConfigForFile returns the correct config', (t) => {
  const rightCollectionFileConfig = { regex: '^right-.*', bucket: 'right-bucket' };
  const wrongCollectionFileConfig = { regex: '^wrong-.*', bucket: 'wrong-bucket' };
  const collectionConfig = {
    files: [rightCollectionFileConfig, wrongCollectionFileConfig]
  };

  const testGranule = new TestGranule({}, collectionConfig, {});

  const file = { name: 'right-file' };
  const fileCollectionConfig = testGranule.findCollectionFileConfigForFile(file);

  t.deepEqual(fileCollectionConfig, rightCollectionFileConfig);
});

test('findCollectionFileConfigForFile returns undefined if no config matches', (t) => {
  const wrongCollectionFileConfig = { regex: '^wrong-.*', bucket: 'wrong-bucket' };
  const collectionConfig = {
    files: [wrongCollectionFileConfig]
  };

  const testGranule = new TestGranule({}, collectionConfig, {});

  const file = { name: 'right-file' };
  const fileCollectionConfig = testGranule.findCollectionFileConfigForFile(file);

  t.is(fileCollectionConfig, undefined);
});

test('addBucketToFile throws an exception if no config matches', (t) => {
  const buckets = {
    private: {
      name: 'private-bucket',
      type: 'private'
    }
  };

  const wrongCollectionFileConfig = { regex: '^wrong-.*', bucket: 'wrong-bucket' };
  const collectionConfig = {
    files: [wrongCollectionFileConfig]
  };

  const testGranule = new TestGranule(buckets, collectionConfig, {});

  const file = { name: 'right-file' };

  try {
    testGranule.addBucketToFile(file);
  } catch (e) {
    t.is(e.message, 'Unable to update file. Cannot find file config for file right-file');
  }
});

test('addBucketToFile adds the correct bucket when a config is found', (t) => {
  const buckets = {
    private: {
      name: 'private-bucket',
      type: 'private'
    },
    right: {
      name: 'right-bucket',
      type: 'private'
    }
  };

  const rightCollectionFileConfig = { regex: '^right-.*', bucket: 'right' };
  const wrongCollectionFileConfig = { regex: '^wrong-.*', bucket: 'wrong' };
  const collectionConfig = {
    files: [rightCollectionFileConfig, wrongCollectionFileConfig]
  };

  const testGranule = new TestGranule(buckets, collectionConfig, {});

  const file = { name: 'right-file' };
  const updatedFile = testGranule.addBucketToFile(file);

  t.is(updatedFile.bucket, 'right-bucket');
});

test('addUrlPathToFile adds an emptry string as the url_path if no config matches and no collection url_path is configured', (t) => {
  const collectionConfig = {
    files: []
  };

  const testGranule = new TestGranule({}, collectionConfig, {});

  const file = { name: 'right-file' };
  const updatedFile = testGranule.addUrlPathToFile(file);

  t.is(updatedFile.url_path, '');
});

test("addUrlPathToFile adds the collection config's url_path as the url_path if no config matches and a collection url_path is configured", (t) => {
  const collectionConfig = {
    url_path: '/collection/url/path',
    files: []
  };

  const testGranule = new TestGranule({}, collectionConfig, {});

  const file = { name: 'right-file' };
  const updatedFile = testGranule.addUrlPathToFile(file);

  t.is(updatedFile.url_path, collectionConfig.url_path);
});

test("addUrlPathToFile adds the matching collection file config's url_path as the url_path", (t) => {
  const rightCollectionFileConfig = { regex: '^right-.*', url_path: '/right' };
  const wrongCollectionFileConfig = { regex: '^wrong-.*', url_path: '/wrong' };
  const collectionConfig = {
    url_path: '/collection/url/path',
    files: [rightCollectionFileConfig, wrongCollectionFileConfig]
  };

  const testGranule = new TestGranule({}, collectionConfig, {});

  const file = { name: 'right-file' };
  const updatedFile = testGranule.addUrlPathToFile(file);

  t.is(updatedFile.url_path, rightCollectionFileConfig.url_path);
});

test('moveGranuleFile moves a single file between s3 locations', async (t) => {
  const Bucket = t.context.internalBucket;

  const name = 'test.txt';
  const Key = `origin/${name}`;
  const params = { Bucket, Key, Body: 'test' };
  await s3PutObject(params);

  const source = { Bucket, Key };
  const target = { Bucket, Key: `moved/${name}` };

  await moveGranuleFile(source, target);
  return s3().listObjects({ Bucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);

    const item = list.Contents[0];
    t.is(item.Key, `moved/${name}`);
  });
});

test('moveGranuleFile overwrites existing file by default', async (t) => {
  const sourceBucket = t.context.internalBucket;
  const destBucket = t.context.destBucket;

  const name = 'test.txt';
  const Key = `origin/${name}`;

  // Pre-stage destination file
  await s3PutObject({ Bucket: destBucket, Key, Body: 'initialBody' });

  // Stage source file
  const updatedBody = randomId('updatedBody');
  const params = { Bucket: sourceBucket, Key, Body: updatedBody };
  await s3PutObject(params);

  const source = { Bucket: sourceBucket, Key };
  const target = { Bucket: destBucket, Key };

  try {
    await moveGranuleFile(source, target);
  } catch (err) {
    t.fail();
  } finally {
    const objects = await s3().listObjects({ Bucket: destBucket }).promise();
    t.is(objects.Contents.length, 1);

    const item = objects.Contents[0];
    t.is(item.Key, Key);

    t.is(item.Size, updatedBody.length);
  }
});

test('moveGranuleFiles moves granule files between s3 locations', async (t) => {
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;

  const filenames = [
    'test-one.txt',
    'test-two.md',
    'test-three.jpg'
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await s3PutObject(params);
    return {
      name, bucket, key: sourcefilePath, filename: buildS3Uri(bucket, sourcefilePath)
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket,
      filepath: destinationFilepath
    },
    {
      regex: '.*.md$',
      bucket,
      filepath: destinationFilepath
    },
    {
      regex: '.*.jpg$',
      bucket: secondBucket,
      filepath: destinationFilepath
    }
  ];

  const sourceFiles = await Promise.all(sourceFilePromises);

  // ACT
  await moveGranuleFiles(sourceFiles, destinations);

  // ASSERT
  await s3().listObjects({ Bucket: bucket }).promise().then((list) => {
    t.is(list.Contents.length, 2);

    list.Contents.forEach((item) => {
      t.is(item.Key.indexOf(destinationFilepath), 0);
    });
  });

  return s3().listObjects({ Bucket: secondBucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);

    list.Contents.forEach((item) => {
      t.is(item.Key.indexOf(destinationFilepath), 0);
    });
  });
});

test('moveGranuleFiles only moves granule files specified with regex', async (t) => {
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;

  const filenames = [
    'included-in-move.txt',
    'excluded-from-move'
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await s3PutObject(params);
    return {
      name, bucket, key: sourcefilePath, filename: buildS3Uri(bucket, sourcefilePath)
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: secondBucket,
      filepath: destinationFilepath
    }
  ];

  const sourceFiles = await Promise.all(sourceFilePromises);
  await moveGranuleFiles(sourceFiles, destinations);

  await s3().listObjects({ Bucket: bucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);
    t.is(list.Contents[0].Key, 'origin/excluded-from-move');
  });

  return s3().listObjects({ Bucket: secondBucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);
    t.is(list.Contents[0].Key, 'destination/included-in-move.txt');
  });
});


test('moveGranuleFiles returns an updated list of files in their new locations.', async (t) => {
  const bucket = t.context.internalBucket;
  const secondBucket = t.context.destBucket;

  const filenames = [
    'test-one.txt',
    'test-two.md',
    'test-three.jpg'
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await s3PutObject(params);
    return {
      name, bucket, key: sourcefilePath, filename: buildS3Uri(bucket, sourcefilePath)
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket,
      filepath: destinationFilepath
    },
    {
      regex: '.*.md$',
      bucket,
      filepath: destinationFilepath
    },
    {
      regex: '.*.jpg$',
      bucket: secondBucket,
      filepath: destinationFilepath
    }
  ];

  const expectedUpdatedFiles = [
    {
      name: 'test-one.txt',
      bucket: bucket,
      key: 'destination/test-one.txt'
    },
    {
      name: 'test-two.md',
      bucket: bucket,
      key: 'destination/test-two.md'
    },
    {
      name: 'test-three.jpg',
      bucket: secondBucket,
      key: 'destination/test-three.jpg'
    }
  ];

  const sourceFiles = await Promise.all(sourceFilePromises);

  // ACT
  const updatedFiles = await moveGranuleFiles(sourceFiles, destinations);

  expectedUpdatedFiles.forEach((expected) => {
    const updatedFile = updatedFiles.find(
      (file) =>
        file.bucket === expected.bucket
        && file.key === expected.key
    );
    t.deepEqual(updatedFile, expected);
  });
});

test('generateMoveFileParams generates correct parameters', (t) => {
  const filenames = [
    'included-in-move.txt',
    'another-move.txt'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = 'dest-bucket';

  const sourceFiles = filenames.map((name) => {
    const sourcefilePath = `origin/${name}`;
    return {
      name,
      bucket: sourceBucket,
      key: sourcefilePath
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: destBucket,
      filepath: destinationFilepath
    }
  ];

  const moveFileParams = generateMoveFileParams(sourceFiles, destinations);

  moveFileParams.map((item, index) => t.deepEqual(item, {
    file: sourceFiles[index],
    source: {
      Bucket: sourceBucket,
      Key: `origin/${filenames[index]}`
    },
    target: {
      Bucket: destBucket,
      Key: `${destinationFilepath}/${filenames[index]}`
    }
  }));
});

test('generateMoveFileParams generates null source and target for no destination', (t) => {
  const filenames = [
    'included-in-move.txt',
    'exclude'
  ];

  const sourceBucket = 'test-bucket';
  const destBucket = 'dest-bucket';

  const sourceFiles = filenames.map((name) => {
    const sourcefilePath = `origin/${name}`;
    return {
      name,
      bucket: sourceBucket,
      key: sourcefilePath
    };
  });

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: destBucket,
      filepath: destinationFilepath
    }
  ];

  const moveFileParams = generateMoveFileParams(sourceFiles, destinations);

  t.deepEqual(moveFileParams[1], {
    file: sourceFiles[1],
    source: null,
    target: null
  });
});

test('renameS3FileWithTimestamp renames file', async (t) => {
  const bucket = t.context.internalBucket;
  const key = `${randomString()}/test.hdf`;
  const params = { Bucket: bucket, Key: key, Body: randomString() };
  await s3PutObject(params);
  // put an existing renamed file
  const formatString = 'YYYYMMDDTHHmmssSSS';
  const existingRenamedKey = `${key}.v${moment.utc().format(formatString)}`;
  const existingRenamedParams = {
    Bucket: bucket, Key: existingRenamedKey, Body: randomString()
  };
  await s3PutObject(existingRenamedParams);
  await renameS3FileWithTimestamp(bucket, key);
  const renamedFiles = await getRenamedS3File(bucket, key);

  t.is(renamedFiles.length, 2);
  // renamed files have the right prefix
  renamedFiles.map((f) => t.true(f.Key.startsWith(`${key}.v`)));
  // one of the file is the existing renamed file
  t.true(renamedFiles.map((f) => f.Key).includes(existingRenamedKey));
});

class TestS3Granule extends s3Mixin(baseProtocol(Granule)) {}

const collectionConfig = {
  dataType: 'testDataType',
  version: 'testVersion',
  files: [
    {
      regex: '^[A-Z]|[a-z]+\.txt'
    }
  ]
};

test('ingestFile keeps both new and old data when duplicateHandling is version', async (t) => {
  const sourceBucket = t.context.internalBucket;
  const destBucket = t.context.destBucket;
  const file = {
    path: randomString(),
    name: 'test.txt'
  };
  const key = path.join(file.path, file.name);
  const params = { Bucket: sourceBucket, Key: key, Body: randomString() };
  await s3PutObject(params);

  const duplicateHandling = 'version';
  // leading '/' should be trimmed
  const fileStagingDir = '/file-staging';
  const testGranule = new TestS3Granule(
    {},
    collectionConfig,
    {
      host: sourceBucket
    },
    fileStagingDir,
    false,
    duplicateHandling,
  );

  const oldfiles = await testGranule.ingestFile(file, destBucket, duplicateHandling);
  t.is(oldfiles.length, 1);
  t.is(oldfiles[0].duplicate_found, undefined);

  // update the source file with different content and ingest again
  params.Body = randomString();
  await s3PutObject(params);
  const newfiles = await testGranule.ingestFile(file, destBucket, duplicateHandling);
  t.is(newfiles.length, 2);
  t.true(newfiles[0].duplicate_found);
});

test('ingestFile throws error when configured to handle duplicates with error', async (t) => {
  const sourceBucket = t.context.internalBucket;
  const destBucket = t.context.destBucket;

  const file = {
    path: '',
    name: 'test.txt'
  };

  const Key = path.join(file.path, file.name);
  const params = { Bucket: sourceBucket, Key, Body: 'test' };
  await s3PutObject(params);

  const duplicateHandling = 'error';
  const fileStagingDir = 'file-staging';
  const testGranule = new TestS3Granule(
    {},
    collectionConfig,
    {
      host: sourceBucket
    },
    fileStagingDir,
    false,
    duplicateHandling,
  );

  // This test needs to use a unique bucket for each test (or remove the object
  // added to the destination bucket). Otherwise, it will throw an error on the
  // first attempt to ingest the file.
  await testGranule.ingestFile(file, destBucket, duplicateHandling);
  const error = await t.throws(testGranule.ingestFile(file, destBucket, duplicateHandling));
  const destFileKey = path.join(fileStagingDir, testGranule.collectionId, file.name);
  t.true(error instanceof errors.DuplicateFile);
  t.is(error.message, `${destFileKey} already exists in ${destBucket} bucket`);
});

test('ingestFile skips ingest when duplicateHandling is skip', async (t) => {
  const sourceBucket = t.context.internalBucket;
  const destBucket = t.context.destBucket;
  const file = {
    path: randomString(),
    name: 'test.txt'
  };
  const key = path.join(file.path, file.name);
  const params = { Bucket: sourceBucket, Key: key, Body: randomString(30) };
  await s3PutObject(params);

  const duplicateHandling = 'skip';
  const fileStagingDir = 'file-staging';
  const testGranule = new TestS3Granule(
    {},
    collectionConfig,
    {
      host: sourceBucket
    },
    fileStagingDir,
    false,
    duplicateHandling,
  );

  const oldfiles = await testGranule.ingestFile(file, destBucket, duplicateHandling);
  t.is(oldfiles.length, 1);
  t.is(oldfiles[0].duplicate_found, undefined);
  t.is(oldfiles[0].fileSize, params.Body.length);

  // update the source file with different content and ingest again
  params.Body = randomString(100);
  await s3PutObject(params);
  const newfiles = await testGranule.ingestFile(file, destBucket, duplicateHandling);
  t.is(newfiles.length, 1);
  t.true(newfiles[0].duplicate_found);
  t.is(newfiles[0].fileSize, oldfiles[0].fileSize);
  t.not(newfiles[0].fileSize, params.Body.length);
});

test('ingestFile replaces file when duplicateHandling is replace', async (t) => {
  const sourceBucket = t.context.internalBucket;
  const destBucket = t.context.destBucket;
  const file = {
    path: randomString(),
    name: 'test.txt'
  };
  const key = path.join(file.path, file.name);
  const params = { Bucket: sourceBucket, Key: key, Body: randomString(30) };
  await s3PutObject(params);

  const duplicateHandling = 'replace';
  const fileStagingDir = 'file-staging';
  const testGranule = new TestS3Granule(
    {},
    collectionConfig,
    {
      host: sourceBucket
    },
    fileStagingDir,
    false,
    duplicateHandling,
  );

  const oldfiles = await testGranule.ingestFile(file, destBucket, duplicateHandling);
  t.is(oldfiles.length, 1);
  t.is(oldfiles[0].duplicate_found, undefined);
  t.is(oldfiles[0].fileSize, params.Body.length);

  // update the source file with different content and ingest again
  params.Body = randomString(100);
  await s3PutObject(params);
  const newfiles = await testGranule.ingestFile(file, destBucket, duplicateHandling);
  t.is(newfiles.length, 1);
  t.true(newfiles[0].duplicate_found);
  t.not(newfiles[0].fileSize, oldfiles[0].fileSize);
  t.is(newfiles[0].fileSize, params.Body.length);
});

test('ingestFile throws an error when invalid checksum is provided', async (t) => {
  const sourceBucket = t.context.internalBucket;
  const destBucket = t.context.destBucket;

  const file = {
    path: '',
    name: 'test.txt',
    checksumType: 'md5',
    checksumValue: 'badchecksum'
  };

  const Key = path.join(file.path, file.name);
  const params = { Bucket: sourceBucket, Key, Body: randomString(30) };
  await s3PutObject(params);

  const duplicateHandling = 'replace';
  const fileStagingDir = 'file-staging';
  const testGranule = new TestS3Granule(
    {},
    collectionConfig,
    {
      host: sourceBucket
    },
    fileStagingDir,
    false,
    duplicateHandling,
  );

  const stagingPath = path.join(testGranule.fileStagingDir, testGranule.collectionId);
  // This test needs to use a unique bucket for each test (or remove the object
  // added to the destination bucket). Otherwise, it will throw an error on the
  // first attempt to ingest the file.
  const error = await t.throws(testGranule.ingestFile(file, destBucket, duplicateHandling));
  t.true(error instanceof errors.InvalidChecksum);
  t.is(error.message, `Invalid checksum for S3 object s3://${destBucket}/${stagingPath}/${file.name}`
    + ` with type ${file.checksumType} and expected sum ${file.checksumValue}`);
});

test('ingestFile throws an error when no checksum is provided and the fileSize is not as expected', async (t) => {
  const sourceBucket = t.context.internalBucket;
  const destBucket = t.context.destBucket;

  const file = {
    path: '',
    name: 'test.txt',
    fileSize: 123456789
  };

  const Key = path.join(file.path, file.name);
  const params = { Bucket: sourceBucket, Key, Body: randomString(30) };
  await s3PutObject(params);

  const duplicateHandling = 'replace';
  const fileStagingDir = 'file-staging';
  const testGranule = new TestS3Granule(
    {},
    collectionConfig,
    {
      host: sourceBucket
    },
    fileStagingDir,
    false,
    duplicateHandling,
  );

  // This test needs to use a unique bucket for each test (or remove the object
  // added to the destination bucket). Otherwise, it will throw an error on the
  // first attempt to ingest the file.
  const error = await t.throws(testGranule.ingestFile(file, destBucket, duplicateHandling));
  t.true(error instanceof errors.UnexpectedFileSize);
  t.is(error.message, `verifyFile failed: Actual filesize ${params.Body.length}`
    + ` did not match expected fileSize ${file.fileSize}`);
});

test('unversionFilename returns original filename if it has no timestamp', (t) => {
  const noTimeStampFilename = 'somefile.v1';
  const expected = noTimeStampFilename;

  const actual = unversionFilename(noTimeStampFilename);

  t.is(expected, actual);
});

test('unversionFilename returns filename without version stamp if present', (t) => {
  const timeStampedFilename = 'somefile.v20181231T000122333';
  const expected = 'somefile';

  const actual = unversionFilename(timeStampedFilename);

  t.is(expected, actual);
});
