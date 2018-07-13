'use strict';

const fs = require('fs');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const test = require('ava');
const JSFtp = require('jsftp');
const {
  aws: {
    recursivelyDeleteS3Bucket,
    s3
  }
} = require('@cumulus/common');
const {
  randomString
} = require('@cumulus/common/test-utils');

const privateKey = 'ssh_client_rsa_key';
const bucket = randomString();
const stackName = randomString();

process.env.internal = bucket;
process.env.stackName = stackName;

class MyTestDiscoveryClass {
  constructor(useList) {
    this.decrypted = true;
    this.host = 'localhost';
    this.port = '2222';
    this.username = 'user';
    this.path = '/pdrs';
    this.provider = {
      encrypted: false,
      privateKey: privateKey
    };
    this.useList = useList;
  }
}

test.beforeEach(async (t) => {
  // let's copy the key to s3
  await s3().createBucket({ Bucket: bucket }).promise();

  const privKey = fs.readFileSync(`../test-data/keys/${privateKey}`, 'utf-8');

  await s3().putObject({
    Bucket: bucket,
    Key: `${stackName}/crypto/${privateKey}`,
    Body: privKey
  }).promise();
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(bucket)
  ]);
});

test('connect and retrieve list of pdrs', async (t) => {

  const jsftpSpy = sinon.spy(JSFtp);
  const { sftpMixin } = proxyquire('../sftp', {
    jsftp: jsftpSpy
  });

  class MyTestSftpDiscoveryClass extends sftpMixin(MyTestDiscoveryClass) {}
  const myTestSftpDiscoveryClass = new MyTestSftpDiscoveryClass(true);
  const list = await myTestSftpDiscoveryClass.list();
  t.is(list.length > 0, true);
});

