'use strict';

const test = require('ava');
const { httpMixin: TestHttpMixin } = require('../http');
const {
  checksumS3Objects, fileExists, recursivelyDeleteS3Bucket, s3
} = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

class MyTestDiscoveryClass {
  constructor(useList) {
    this.decrypted = true;
    this.host = 'http://localhost:3030';
    this.path = '/';
    this.provider = { encrypted: false };
    this.useList = useList;
  }
}

test('Download remote file to s3', async (t) => {
  class MyTestHttpDiscoveryClass extends TestHttpMixin(MyTestDiscoveryClass) {}
  const myTestHttpDiscoveryClass = new MyTestHttpDiscoveryClass();
  const bucket = randomString();
  const key = randomString();
  try {
    await s3().createBucket({ Bucket: bucket }).promise();
    await myTestHttpDiscoveryClass.sync(
      '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', bucket, key
    );
    t.truthy(fileExists(bucket, key));
    const sum = await checksumS3Objects('CKSUM', bucket, key);
    t.is(sum, 1435712144);
  }
  finally {
    await recursivelyDeleteS3Bucket(bucket);
  }
});
