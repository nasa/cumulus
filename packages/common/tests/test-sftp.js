'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('ava');
const { generateChecksumFromStream } = require('@cumulus/checksum');
const {
  calculateS3ObjectChecksum,
  fileExists,
  recursivelyDeleteS3Bucket,
  s3,
  s3PutObject,
  headObject
} = require('../aws');

const {
  randomString
} = require('../test-utils');
const { Sftp } = require('../sftp');

const privateKey = 'ssh_client_rsa_key';
const bucket = randomString();
const stackName = randomString();

process.env.system_bucket = bucket;
process.env.stackName = stackName;

const sftpConfig = {
  host: '127.0.0.1',
  port: '2222',
  username: 'user',
  encrypted: false,
  privateKey: privateKey
};

test.before(async () => {
  // let's copy the key to s3
  await s3().createBucket({ Bucket: bucket }).promise();

  const privKey = fs.readFileSync(`../test-data/keys/${privateKey}`, 'utf-8');

  await s3PutObject({
    Bucket: bucket,
    Key: `${stackName}/crypto/${privateKey}`,
    Body: privKey
  });
});

test.after.always(async () => {
  await Promise.all([
    recursivelyDeleteS3Bucket(bucket)
  ]);
});

test('connect and retrieve list of files', async (t) => {
  const testSftpClient = new Sftp(sftpConfig);
  testSftpClient.connect();
  const list = await testSftpClient.list('/');
  t.is(list.length > 0, true);
  await testSftpClient.end();
});

test('Download remote file to local disk', async (t) => {
  const testSftpClient = new Sftp(sftpConfig);

  const localPath = path.join(os.tmpdir(), `delete-me-${randomString()}.txt`);
  await testSftpClient.download(
    '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', localPath
  );

  const sum = await generateChecksumFromStream('CKSUM', fs.createReadStream(localPath));
  t.is(sum, 1435712144);
  fs.unlinkSync(localPath);
  await testSftpClient.end();
});

test('Download remote file to s3 with correct content-type', async (t) => {
  const testSftpClient = new Sftp(sftpConfig);
  const expectedContentType = 'application/x-hdf';

  const key = `${randomString()}.hdf`;
  await testSftpClient.downloadToS3(
    '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', bucket, key
  );
  t.truthy(fileExists(bucket, key));
  const sum = await calculateS3ObjectChecksum({ algorithm: 'CKSUM', bucket, key });
  t.is(sum, 1435712144);

  const s3HeadResponse = await headObject(bucket, key);
  t.is(expectedContentType, s3HeadResponse.ContentType);
  await testSftpClient.end();
});

test('Upload file from s3 to remote', async (t) => {
  const s3object = { Bucket: bucket, Key: `delete-me-${randomString()}.txt` };
  await s3PutObject({ Body: randomString(), ...s3object });
  const testSftpClient = new Sftp(sftpConfig);
  await testSftpClient.uploadFromS3(s3object, '/granules/delete-me-test-s3-file');
  t.pass();
  await testSftpClient.end();
});

test('Upload data string to remote', async (t) => {
  const testSftpClient = new Sftp(sftpConfig);
  await testSftpClient.uploadFromString(
    `${randomString()}${randomString()}`,
    '/granules/delete-me-test-data-file'
  );
  t.pass();
  await testSftpClient.end();
});
