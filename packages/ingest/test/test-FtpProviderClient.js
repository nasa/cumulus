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
const FtpProviderClient = require('../FtpProviderClient');

test('useList is present and true when assigned', async (t) => {
  const jsftpSpy = sinon.spy(JSFtp);
  const ProxiedFtpProviderClient = proxyquire('../FtpProviderClient', {
    jsftp: jsftpSpy
  });

  const myFtpProviderClient = new ProxiedFtpProviderClient({
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
    useList: true
  });

  await myFtpProviderClient.list('');

  t.is(jsftpSpy.callCount, 1);
  t.is(jsftpSpy.getCall(0).args[0].useList, true);
});

test('useList defaults to false when not assigned', async (t) => {
  const jsftpSpy = sinon.spy(JSFtp);
  const ProxiedFtpProviderClient = proxyquire('../FtpProviderClient', {
    jsftp: jsftpSpy
  });

  const myFtpProviderClient = new ProxiedFtpProviderClient({
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass'
  });

  await myFtpProviderClient.list('');

  t.is(jsftpSpy.callCount, 1);
  t.is(jsftpSpy.getCall(0).args[0].useList, false);
});

test('Download remote file to s3 with correct content-type', async (t) => {
  const myFtpProviderClient = new FtpProviderClient({
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
    path: '',
    useList: true
  });

  const bucket = randomString();
  const key = `${randomString()}.hdf`;
  const expectedContentType = 'application/x-hdf';
  try {
    await s3().createBucket({ Bucket: bucket }).promise();
    await myFtpProviderClient.sync(
      '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', bucket, key
    );
    t.truthy(fileExists(bucket, key));
    const sum = await calculateS3ObjectChecksum({ algorithm: 'CKSUM', bucket, key });
    t.is(sum, 1435712144);

    const s3HeadResponse = await headObject(bucket, key);
    t.is(expectedContentType, s3HeadResponse.ContentType);
  } finally {
    await recursivelyDeleteS3Bucket(bucket);
  }
});
