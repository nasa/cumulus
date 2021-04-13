const cryptoRandomString = require('crypto-random-string');
const test = require('ava');
const { s3 } = require('@cumulus/aws-client/services');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const { storeErrors } = require('../dist/lambda/storeErrors');

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

test('storeErrors calls s3PutObject', async (t) => {
  const recordClassification = 'classification';
  await storeErrors(process.env.system_bucket, 'message', recordClassification, process.env.stackName);
  const filename = `data-migration2-${recordClassification}-errors.json`;
  const key = `${process.env.stackName}/${filename}`;
  const item = await s3().getObject({
    Bucket: process.env.system_bucket,
    Key: key,
  }).promise();
  const messageBody = JSON.parse(item.Body);
  t.deepEqual(messageBody, { errors: 'message' });
});
