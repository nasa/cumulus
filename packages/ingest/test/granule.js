const path = require('path');

const test = require('ava');
const discoverPayload = require('@cumulus/test-data/payloads/new-message-schema/discover.json');
const ingestPayload = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');

const {
  selector,
  FtpGranule,
  SftpGranule,
  HttpGranule,
  S3Granule,
  FtpDiscoverGranules,
  HttpDiscoverGranules,
  SftpDiscoverGranules,
  S3DiscoverGranules,
  FtpDiscoverAndQueueGranules,
  HttpDiscoverAndQueueGranules,
  SftpDiscoverAndQueueGranules,
  S3DiscoverAndQueueGranules
} = require('../granule');

/**
* test that granule.selector() returns the correct class
**/

const selectorDiscoverTypes = [
  { cls: FtpDiscoverGranules, type: 'discover', protocol: 'ftp' },
  { cls: HttpDiscoverGranules, type: 'discover', protocol: 'http' },
  { cls: HttpDiscoverGranules, type: 'discover', protocol: 'https' },
  { cls: SftpDiscoverGranules, type: 'discover', protocol: 'sftp' },
  { cls: S3DiscoverGranules, type: 'discover', protocol: 's3' },
  { cls: FtpDiscoverAndQueueGranules, type: 'discover', protocol: 'ftp', queue: true },
  { cls: HttpDiscoverAndQueueGranules, type: 'discover', protocol: 'http', queue: true },
  { cls: HttpDiscoverAndQueueGranules, type: 'discover', protocol: 'https', queue: true },
  { cls: SftpDiscoverAndQueueGranules, type: 'discover', protocol: 'sftp', queue: true },
  { cls: S3DiscoverAndQueueGranules, type: 'discover', protocol: 's3', queue: true }
];

const selectorSyncTypes = [
  { cls: HttpGranule, type: 'ingest', protocol: 'http' },
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
* test the granule._validateChecksum() method
**/

const sums = require('./fixtures/sums');

Object.keys(sums).forEach((key) => {
  test(`granule._validateChecksum ${key}`, async (t) => {
    const granule = new HttpGranule(
      ingestPayload.config.buckets,
      ingestPayload.config.collection,
      ingestPayload.config.provider
    );
    const filepath = path.join(__dirname, 'fixtures', `${key}.txt`);
    const validated = await granule._validateChecksum(key, sums[key], filepath);
    t.true(validated);
  });
});

test('filter files using regex', (t) => {
  const payload = Object.assign({}, discoverPayload);
  payload.config.collection.granuleIdExtraction = '^example$';
  const discover = new HttpDiscoverGranules(discoverPayload);
  const file = {
    name: 'example'
  };
  const result = discover.setGranuleInfo(file);
  t.true(result === false);
});
