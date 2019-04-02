'use strict';

const rewire = require('rewire');
const test = require('ava');
const http = rewire('../http');
const TestHttpMixin = http.httpMixin;
const EventEmitter = require('events');
const {
  calculateS3ObjectChecksum, fileExists, recursivelyDeleteS3Bucket, s3
} = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const stubLink = 'file.txt';
class TestEmitter extends EventEmitter {
  start() {
    this.emit('fetchcomplete', null, `<a href="${stubLink}">link</a>`);
  }
}
http.__set__('Crawler', TestEmitter);

class MyTestDiscoveryClass {
  constructor(useList) {
    this.decrypted = true;
    this.path = '';
    this.provider = {
      protocol: 'http',
      host: 'localhost',
      port: 3030,
      encrypted: false
    };
    this.useList = useList;
  }
}

class MyTestHttpDiscoveryClass extends TestHttpMixin(MyTestDiscoveryClass) {}
const myTestHttpDiscoveryClass = new MyTestHttpDiscoveryClass();

test('Download remote file to s3', async (t) => {
  const bucket = randomString();
  const key = randomString();
  try {
    await s3().createBucket({ Bucket: bucket }).promise();
    await myTestHttpDiscoveryClass.sync(
      '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', bucket, key
    );
    t.truthy(fileExists(bucket, key));
    const sum = await calculateS3ObjectChecksum({ algorithm: 'CKSUM', bucket, key });
    t.is(sum, 1435712144);
  }
  finally {
    await recursivelyDeleteS3Bucket(bucket);
  }
});

test('returns files with provider path', async (t) => {
  const actualFiles = await myTestHttpDiscoveryClass.list();
  const expectedFiles = [{ name: stubLink, path: myTestHttpDiscoveryClass.path }];
  t.deepEqual(actualFiles, expectedFiles);
});
