const path = require('path');
const aws = require('@cumulus/common/aws');
const testUtils = require('@cumulus/common/test-utils');

const test = require('ava');
const discoverPayload = require('@cumulus/test-data/payloads/modis/discover.json');
const ingestPayload = require('@cumulus/test-data/payloads/modis/ingest.json');

const {
  selector,
  FtpGranule,
  SftpGranule,
  HttpGranule,
  FtpDiscoverGranules,
  SftpDiscoverGranules,
  FtpDiscoverAndQueueGranules,
  SftpDiscoverAndQueueGranules
} = require('../granule');

// Create an S3 bucket for each test
test.beforeEach((t) => {
  t.context.bucket = testUtils.randomString(); // eslint-disable-line no-param-reassign
  return aws.s3().createBucket({ Bucket: t.context.bucket }).promise();
});

// Delete the S3 bucket created in setup
test.afterEach.always((t) => aws.recursivelyDeleteS3Bucket(t.context.bucket));

test('findNewGranules returns files which do not yet exist in S3', async (t) => {
  const event = {
    collection: {
      meta: {
        files: []
      }
    },
    provider: {
      host: 'localhost'
    }
  };
  const granuleDiscoveryObject = new SftpDiscoverGranules(event);

  await aws.s3().putObject({
    Bucket: t.context.bucket,
    Key: 'not-new-key-123',
    Body: 'asdf'
  }).promise();

  const files = [
    { granuleId: 'not-new-id-123', bucket: t.context.bucket, key: 'not-new-key-123' },
    { granuleId: 'new-id-124', bucket: t.context.bucket, key: 'new-key-124' },
    { granuleId: 'new-id-125', bucket: t.context.bucket, key: 'new-key-125a' },
    { granuleId: 'new-id-125', bucket: t.context.bucket, key: 'new-key-125b' }
  ];

  const expected = [
    {
      granuleId: 'new-id-124',
      files: [
        { bucket: t.context.bucket, key: 'new-key-124' }
      ]
    },
    {
      granuleId: 'new-id-125',
      files: [
        { bucket: t.context.bucket, key: 'new-key-125a' },
        { bucket: t.context.bucket, key: 'new-key-125b' }
      ]
    }
  ];

  const actual = await granuleDiscoveryObject.findNewGranules(files);

  t.deepEqual(actual, expected);
});

/**
* test that granule.selector() returns the correct class
**/

const selectorTypes = [
  { cls: HttpGranule, type: 'ingest', protocol: 'http' },
  { cls: FtpGranule, type: 'ingest', protocol: 'ftp' },
  { cls: SftpGranule, type: 'ingest', protocol: 'sftp' },
  { cls: FtpDiscoverGranules, type: 'discover', protocol: 'ftp' },
  { cls: SftpDiscoverGranules, type: 'discover', protocol: 'sftp' },
  { cls: FtpDiscoverAndQueueGranules, type: 'discover', protocol: 'ftp', queue: true },
  { cls: SftpDiscoverAndQueueGranules, type: 'discover', protocol: 'sftp', queue: true }
];

selectorTypes.forEach((item) => {
  test(`test selector ${item.type}-${item.protocol}`, (t) => {
    const payload = item.type === 'ingest' ? ingestPayload : discoverPayload;
    const Cls = selector(item.type, item.protocol, item.queue);
    const instance = new Cls(payload);
    t.true(instance instanceof item.cls);
  });
});

/**
* test the granule._validateChecksum() method
**/

const sums = require('./fixtures/sums');

Object.keys(sums).forEach((key) => {
  test(`granule._validateChecksum ${key}`, async (t) => {
    const granule = new HttpGranule(ingestPayload);
    const filepath = path.join(__dirname, 'fixtures', `${key}.txt`);
    const validated = await granule._validateChecksum(key, sums[key], filepath);
    t.true(validated);
  });
});
