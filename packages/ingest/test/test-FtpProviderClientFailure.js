'use strict';

const test = require('ava');
const JSFtp = require('jsftp');

const FtpProviderClient = require('../FtpProviderClient');

const executeRawFtpCommand = async (cmd) => {
  const jsftp = new JSFtp({
    host: '127.0.0.1',
    port: 21,
    user: 'testuser',
    pass: 'testpass'
  });
  return new Promise((resolve, reject) => {
    jsftp.raw(cmd, (err, data) => {
      if (err) reject(err);
      resolve(data);
    });
  });
};

test.before(async () => {
  // await when fixed
  executeRawFtpCommand('chmod 400 -R forbidden/file.txt');
});

test.after.always(async () => {
  // await when fixed
  executeRawFtpCommand('chmod 644 -R forbidden/file.txt');
});

test.skip('FtpProviderClient throws an error when listing a non-permitted directory', async (t) => {
  // TODO: update cumuluss/vsftpd to allow `chmod` to work in the setup for this test.
  const myFtpProviderClient = new FtpProviderClient({
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
    useList: true
  });

  const error = await t.throwsAsync(myFtpProviderClient.list('forbidden/file.txt'));
  t.true(/^.*451.*forbidden\/file\.txt.*/.test(error.message));
});
