const cryptoRandomString = require('crypto-random-string');
const fs = require('fs');
const JSONStream = require('JSONStream');
const test = require('ava');
const { finished } = require('stream');
const { promisify } = require('util');
const { Stream } = require('stream');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
  getObjectStreamContents,
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');

const { closeErrorWriteStreams, createErrorFileWriteStream, storeErrors } = require('../dist/lambda/storeErrors');

test.before(async () => {
  process.env = {
    ...process.env,
    stackName: cryptoRandomString({ length: 10 }),
    system_bucket: cryptoRandomString({ length: 10 }),
  };

  await createBucket(process.env.system_bucket);
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('storeErrors stores file on s3', async (t) => {
  const file = `message_${cryptoRandomString({ length: 5 })}.txt`;
  const migrationName = 'classification';
  const filename = `data-migration2-${migrationName}-errors`;
  const key = `${process.env.stackName}/${filename}-0123.json`;

  const writeStream = fs.createWriteStream(file);
  const message = 'test message';
  writeStream.end(message);

  const streamFinished = promisify(finished);
  await streamFinished(writeStream);

  await storeErrors({
    bucket: process.env.system_bucket,
    filepath: file,
    migrationName,
    stackName: process.env.stackName,
    timestamp: '0123',
  });

  const item = await s3().getObject({
    Bucket: process.env.system_bucket,
    Key: key,
  });
  t.deepEqual(await getObjectStreamContents(item.Body), message);
});

test.serial('createErrorFileWriteStream returns write streams and string', (t) => {
  const migrationName = `test-migration-name-${cryptoRandomString({ length: 5 })}`;
  const timestamp = new Date().toISOString();
  const expectedFilePath = `${migrationName}ErrorLog-${timestamp}.json`;

  const {
    errorFileWriteStream,
    jsonWriteStream,
    filepath,
  } = createErrorFileWriteStream(migrationName, timestamp);
  t.is(filepath, expectedFilePath);
  t.true(jsonWriteStream instanceof Stream);

  t.teardown(async () => {
    jsonWriteStream.end();
    errorFileWriteStream.end();
    const asyncFinished = promisify(finished);
    await asyncFinished(errorFileWriteStream);
    fs.unlinkSync(expectedFilePath);
  });
});

test.serial('closeErrorFileWriteStream closes write stream', async (t) => {
  const filepath = `test_${cryptoRandomString({ length: 5 })}.txt`;
  const errorFileWriteStream = fs.createWriteStream(filepath);
  const jsonWriteStream = JSONStream.stringify();
  await t.notThrowsAsync(closeErrorWriteStreams({ errorFileWriteStream, jsonWriteStream }));
  t.teardown(() => {
    fs.unlinkSync(filepath);
  });
});
