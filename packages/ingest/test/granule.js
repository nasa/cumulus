const fs = require('fs');
const path = require('path');

const test = require('ava');
const discoverPayload = require('./fixtures/discover.json');
const ingestPayload = require('./fixtures/ingest.json');

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
