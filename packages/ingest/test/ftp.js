'use strict';

const sinon = require('sinon');
const proxyquire = require('proxyquire');
const test = require('ava');
const JSFtp = require('jsftp');

class MyTestDiscoveryClass {
  constructor(useList) {
    this.decrypted = true;
    this.host = '127.0.0.1';
    this.password = 'testpass';
    this.path = '/';
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

