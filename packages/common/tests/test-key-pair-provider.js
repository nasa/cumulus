const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  buildS3Client,
  retrieveKey,
} = require('../key-pair-provider');

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  t.context.s3Client = buildS3Client();
  t.context.bucket = cryptoRandomString({ length: 10 });

  await t.context.s3Client.createBucket({ Bucket: t.context.bucket });
});

test('retrieveKey() correctly retrieves key from s3', async (t) => {
  const {
    bucket,
    s3Client,
  } = t.context;

  const keyId = cryptoRandomString({ length: 5 });
  const key = `${process.env.stackName}/crypto/${keyId}`;
  const body = cryptoRandomString({ length: 10 });

  await s3Client.putObject({
    Bucket: bucket,
    Key: key,
    Body: body,
  });

  const keyResponse = await retrieveKey(keyId, t.context.bucket);
  t.is(keyResponse, body);
});
