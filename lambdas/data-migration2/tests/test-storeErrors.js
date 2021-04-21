const cryptoRandomString = require('crypto-random-string');
const fs = require('fs');
const test = require('ava');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');

const { createErrorFileWriteStream, storeErrors } = require('../dist/lambda/storeErrors');

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
  const file = 'message';
  const migrationName = 'classification';
  const filename = `data-migration2-${migrationName}-errors`;
  const key = `${process.env.stackName}/${filename}-0123.json`;

  const stream = fs.createWriteStream(file);
  const message = 'test message';
  stream.end(message);

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
  }).promise();
  t.deepEqual(item.Body.toString(), message);
});

test.serial('createErrorFileWriteStream returns a write stream and string', (t) => {
  const migrationName = 'migration';
  const timestamp = Date.now();

  const { errorFileWriteStream, filepath } = createErrorFileWriteStream(migrationName, timestamp);
  t.is(filepath, `${migrationName}ErrorLog-${timestamp}.json`);
  t.true(errorFileWriteStream instanceof fs.WriteStream);
  t.teardown(() => {
    fs.unlinkSync(filepath);
  });
});
