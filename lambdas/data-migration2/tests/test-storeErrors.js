const cryptoRandomString = require('crypto-random-string');
const test = require('ava');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { getJsonS3Object } = require('@cumulus/aws-client/S3');

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

test('storeErrors stores file on s3', async (t) => {
  const recordClassification = 'classification';
  await storeErrors(process.env.system_bucket, 'message', recordClassification, process.env.stackName);
  const filename = `data-migration2-${recordClassification}-errors.json`;
  const key = `${process.env.stackName}/${filename}`;

  const item = await getJsonS3Object(process.env.system_bucket, key);
  t.deepEqual(item, { errors: 'message' });
});
