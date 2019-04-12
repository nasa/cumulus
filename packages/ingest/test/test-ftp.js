'use strict';

const sinon = require('sinon');
const proxyquire = require('proxyquire');
const test = require('ava');
const JSFtp = require('jsftp');
const {
  calculateS3ObjectChecksum,
  fileExists,
  recursivelyDeleteS3Bucket,
  s3,
  headObject
} = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const { ftpMixin: TestFtpMixin } = require('../ftp');

class MyTestDiscoveryClass {
  constructor(useList) {
    this.decrypted = true;
    this.host = '127.0.0.1';
    this.password = 'testpass';
    this.path = '';
    this.provider = { encrypted: false };
    this.useList = useList;
    this.username = 'testuser';
  }
}

test('useList is present and true when assigned', async (t) => {
  const jsftpSpy = sinon.spy(JSFtp);
  const { ftpMixin } = proxyquire('../ftp', {
    jsftp: jsftpSpy
  });

  class MyTestFtpDiscoveryClass extends ftpMixin(MyTestDiscoveryClass) {}
  const myTestFtpDiscoveryClass = new MyTestFtpDiscoveryClass(true);

  await myTestFtpDiscoveryClass.list();

  t.is(jsftpSpy.callCount, 1);
  t.is(jsftpSpy.getCall(0).args[0].useList, true);
});

test('useList defaults to false when not assigned', async (t) => {
  const jsftpSpy = sinon.spy(JSFtp);
  const { ftpMixin } = proxyquire('../ftp', {
    jsftp: jsftpSpy
  });

  class MyTestFtpDiscoveryClass extends ftpMixin(MyTestDiscoveryClass) {}
  const myTestFtpDiscoveryClass = new MyTestFtpDiscoveryClass();

  await myTestFtpDiscoveryClass.list();

  t.is(jsftpSpy.callCount, 1);
  t.is(jsftpSpy.getCall(0).args[0].useList, false);
});

test('Download remote file to s3 with correct content-type', async (t) => {
  class MyTestFtpDiscoveryClass extends TestFtpMixin(MyTestDiscoveryClass) {}
  const myTestFtpDiscoveryClass = new MyTestFtpDiscoveryClass();
  const bucket = randomString();
  const key = `${randomString()}.hdf`;
  const expectedContentType = 'application/x-hdf';
  try {
    await s3().createBucket({ Bucket: bucket }).promise();
    await myTestFtpDiscoveryClass.sync(
      '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', bucket, key
    );
    t.truthy(fileExists(bucket, key));
    const sum = await calculateS3ObjectChecksum({ algorithm: 'CKSUM', bucket, key });
    t.is(sum, 1435712144);

    const s3HeadResponse = await headObject(bucket, key);
    t.is(expectedContentType, s3HeadResponse.ContentType);
  }
  finally {
    await recursivelyDeleteS3Bucket(bucket);
  }
});
