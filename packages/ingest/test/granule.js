const fs = require('fs-extra');
const path = require('path');

const test = require('ava');
const discoverPayload = require('@cumulus/test-data/payloads/new-message-schema/discover.json');
const ingestPayload = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');
const { randomString } = require('@cumulus/common/test-utils');
const { buildS3Uri, s3, recursivelyDeleteS3Bucket } = require('@cumulus/common/aws');

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
  moveGranuleFiles,
  moveGranuleFile
} = require('../granule');


test.beforeEach(async (t) => {
  t.context.internalBucket = `internal-bucket-${randomString().slice(0, 6)}`;
  await s3().createBucket({ Bucket: t.context.internalBucket }).promise();
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(t.context.internalBucket)
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
* test the granule.validateChecksum() method
**/

const sums = require('./fixtures/sums');

Object.keys(sums).forEach((key) => {
  test(`granule.validateChecksum ${key}`, async (t) => {
    const granule = new HttpGranule(
      ingestPayload.config.buckets,
      ingestPayload.config.collection,
      ingestPayload.config.provider
    );
    const filepath = path.join(__dirname, 'fixtures', `${key}.txt`);
    await s3().putObject({
      Bucket: t.context.internalBucket,
      Key: key,
      Body: fs.createReadStream(filepath)
    }).promise();

    try {
      const file = { checksumType: key, checksumValue: sums[key] };
      await granule.validateChecksum(file, t.context.internalBucket, key);
      await granule.validateChecksum(key, t.context.internalBucket, key);
      t.pass();
    }
    catch (e) {
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
  }
  catch (e) {
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

test('addUrlPathToFile adds an emptry string as the url_path if no config matches and no collection url_path is configured', (t) => { // eslint-disable-line max-len
  const collectionConfig = {
    files: []
  };

  const testGranule = new TestGranule({}, collectionConfig, {});

  const file = { name: 'right-file' };
  const updatedFile = testGranule.addUrlPathToFile(file);

  t.is(updatedFile.url_path, '');
});

test("addUrlPathToFile adds the collection config's url_path as the url_path if no config matches and a collection url_path is configured", (t) => { // eslint-disable-line max-len
  const collectionConfig = {
    url_path: '/collection/url/path',
    files: []
  };

  const testGranule = new TestGranule({}, collectionConfig, {});

  const file = { name: 'right-file' };
  const updatedFile = testGranule.addUrlPathToFile(file);

  t.is(updatedFile.url_path, collectionConfig.url_path);
});

test("addUrlPathToFile adds the matching collection file config's url_path as the url_path", (t) => { // eslint-disable-line max-len
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

test('getBucket adds the correct url_path and bucket to the file', (t) => {
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

  const collectionConfig = {
    files: [rightCollectionFileConfig]
  };

  const testGranule = new TestGranule(buckets, collectionConfig, {});

  const file = { name: 'right-file' };
  const updatedFile = testGranule.getBucket(file);

  t.is(updatedFile.bucket, 'right-bucket');
  t.is(updatedFile.url_path, '');
});

test('moveGranuleFile moves a single file between s3 locations', async (t) => {
  const Bucket = randomString();
  await s3().createBucket({ Bucket }).promise();

  const name = 'test.txt';
  const Key = `origin/${name}`;
  const params = { Bucket, Key, Body: 'test' };
  await s3().putObject(params).promise();

  const source = { Bucket, Key };
  const target = { Bucket, Key: `moved/${name}` };

  await moveGranuleFile(source, target);
  return s3().listObjects({ Bucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);

    const item = list.Contents[0];
    t.is(item.Key, `moved/${name}`);
  });
});

test('moveGranuleFiles moves granule files between s3 locations', async (t) => {
  const bucket = randomString();
  const secondBucket = randomString();
  await s3().createBucket({ Bucket: bucket }).promise();
  await s3().createBucket({ Bucket: secondBucket }).promise();

  const filenames = [
    'test-one.txt',
    'test-two.md',
    'test-three.jpg'
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await s3().putObject(params).promise();
    return {
      name, bucket, filepath: sourcefilePath, filename: buildS3Uri(bucket, sourcefilePath)
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
  await moveGranuleFiles(randomString(), sourceFiles, destinations);

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
  const bucket = randomString();
  const secondBucket = randomString();
  await s3().createBucket({ Bucket: bucket }).promise();
  await s3().createBucket({ Bucket: secondBucket }).promise();

  const filenames = [
    'included-in-move.txt',
    'excluded-from-move'
  ];

  const sourceFilePromises = filenames.map(async (name) => {
    const sourcefilePath = `origin/${name}`;
    const params = { Bucket: bucket, Key: sourcefilePath, Body: name };
    await s3().putObject(params).promise();
    return {
      name, bucket, filepath: sourcefilePath, filename: buildS3Uri(bucket, sourcefilePath)
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
  await moveGranuleFiles(randomString(), sourceFiles, destinations);

  await s3().listObjects({ Bucket: bucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);
    t.is(list.Contents[0].Key, 'origin/excluded-from-move');
  });

  return s3().listObjects({ Bucket: secondBucket }).promise().then((list) => {
    t.is(list.Contents.length, 1);
    t.is(list.Contents[0].Key, 'destination/included-in-move.txt');
  });
});
