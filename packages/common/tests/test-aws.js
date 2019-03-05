'use strict';

const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');
const test = require('ava');
const sinon = require('sinon');

const aws = require('../aws');
const { randomString, throttleOnce } = require('../test-utils');

test('s3Join behaves as expected', (t) => {
  // Handles an array argument
  t.is(aws.s3Join(['a', 'b', 'c']), 'a/b/c');

  t.is(aws.s3Join(['a', 'b']), 'a/b');
  t.is(aws.s3Join(['a', 'b/']), 'a/b/');
  t.is(aws.s3Join(['a/', 'b']), 'a/b');
  t.is(aws.s3Join(['/a', 'b']), 'a/b');
  t.is(aws.s3Join(['a/', 'b']), 'a/b');

  t.is(aws.s3Join(['a']), 'a');
  t.is(aws.s3Join(['/a']), 'a');
  t.is(aws.s3Join(['a/']), 'a/');

  // Handles a list of arguments
  t.is(aws.s3Join('a', 'b'), 'a/b');
});

test('listS3ObjectsV2 handles non-truncated case', async (t) => {
  const Bucket = randomString();
  await aws.s3().createBucket({ Bucket }).promise();

  await Promise.all(['a', 'b', 'c'].map((Key) => aws.s3().putObject({
    Bucket,
    Key,
    Body: 'my-body'
  }).promise()));

  // List things from S3
  const result = await aws.listS3ObjectsV2({ Bucket, MaxKeys: 5 });
  const actualKeys = new Set(result.map((object) => object.Key));
  const expectedKeys = new Set(['a', 'b', 'c']);

  t.deepEqual(actualKeys, expectedKeys);

  return aws.recursivelyDeleteS3Bucket(Bucket);
});

test('listS3ObjectsV2 handles truncated case', async (t) => {
  const Bucket = randomString();
  await aws.s3().createBucket({ Bucket }).promise();

  await Promise.all(['a', 'b', 'c'].map((Key) => aws.s3().putObject({
    Bucket,
    Key,
    Body: 'my-body'
  }).promise()));

  // List things from S3
  const result = await aws.listS3ObjectsV2({ Bucket, MaxKeys: 2 });
  const actualKeys = new Set(result.map((object) => object.Key));
  const expectedKeys = new Set(['a', 'b', 'c']);

  t.deepEqual(actualKeys, expectedKeys);

  return aws.recursivelyDeleteS3Bucket(Bucket);
});

test('downloadS3File rejects promise if key not found', async (t) => {
  const Bucket = randomString();
  await aws.s3().createBucket({ Bucket }).promise();

  try {
    await aws.downloadS3File({ Bucket, Key: 'not-gonna-find-it' }, '/tmp/wut');
  }
  catch (err) {
    t.is(err.message, 'The specified key does not exist.');
  }
});

test('downloadS3File resolves filepath if key is found', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';

  await aws.s3().createBucket({ Bucket }).promise();
  await aws.s3().putObject({ Bucket, Key: Key, Body: Body }).promise();

  const params = { Bucket, Key: Key };
  const filepath = await aws.downloadS3File(params, path.join(tmpdir(), 'example'));

  const result = await new Promise((resolve, reject) => {
    fs.readFile(filepath, 'utf-8', (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  t.is(result, Body);
});

test('pullStepFunctionEvent returns original message if message not on S3', async (t) => {
  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    meta: {
      bucket: 'test bucket'
    }
  };

  const message = await aws.pullStepFunctionEvent(event);

  t.deepEqual(message, event);
});

test.serial('pullStepFunctionEvent returns message from S3', async (t) => {
  const fullMessage = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    meta: {
      bucket: 'test bucket'
    }
  };

  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    replace: {
      Bucket: 'test bucket',
      Key: 'key'
    }
  };

  const stub = sinon.stub(aws, 'getS3Object').resolves({ Body: JSON.stringify(fullMessage) });

  try {
    const message = await aws.pullStepFunctionEvent(event);

    t.deepEqual(message, fullMessage);
  }
  finally {
    stub.restore();
  }
});

test('retryOnThrottlingException() properly retries after ThrottlingExceptions', async (t) => {
  const asyncSquare = (x) => Promise.resolve(x * x);

  const throttledAsyncSquare = throttleOnce(asyncSquare);

  const throttledAsyncSquareWithRetries = aws.retryOnThrottlingException(throttledAsyncSquare);

  t.is(
    await throttledAsyncSquareWithRetries(3),
    9
  );
});

test('better stack traces', async (t) => {
  const f = () => aws.getS3Object('asdf');
  const g = () => f();
  const h = () => g();

  try {
    console.log(await h());
    t.fail('Expected an exception');
  }
  catch (err) {
    t.true(err.stack.includes(path.basename(__filename)));
  }
});

test('calculateS3ObjectChecksum returns correct checksum', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';
  const cksum = 148323542;
  const md5sum = '1a79a4d60de6718e8e5b326e338ae533';
  const shasum = 'c3499c2729730a7f807efb8676a92dcb6f8a3f8f';
  const sha256sum = '50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c';

  await aws.s3().createBucket({ Bucket }).promise();
  await aws.s3().putObject({ Bucket, Key, Body }).promise();

  const ck = await aws.calculateS3ObjectChecksum({ algorithm: 'cksum', bucket: Bucket, key: Key });
  const md5 = await aws.calculateS3ObjectChecksum({ algorithm: 'md5', bucket: Bucket, key: Key });
  const sha1 = await aws.calculateS3ObjectChecksum({ algorithm: 'sha1', bucket: Bucket, key: Key });
  const sha256 = await aws.calculateS3ObjectChecksum({ algorithm: 'sha256', bucket: Bucket, key: Key });
  t.is(ck, cksum);
  t.is(md5, md5sum);
  t.is(sha1, shasum);
  t.is(sha256, sha256sum);
  return aws.recursivelyDeleteS3Bucket(Bucket);
});

test('validateS3ObjectChecksum returns true for good checksum', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';

  await aws.s3().createBucket({ Bucket }).promise();
  await aws.s3().putObject({ Bucket, Key, Body }).promise();

  const cksum = 148323542;
  const ret = await aws.validateS3ObjectChecksum({
    algorithm: 'cksum', bucket: Bucket, key: Key, expectedSum: cksum
  });
  t.true(ret);
  return aws.recursivelyDeleteS3Bucket(Bucket);
});

test('validateS3ObjectChecksum throws InvalidChecksum error on bad checksum', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';

  await aws.s3().createBucket({ Bucket }).promise();
  await aws.s3().putObject({ Bucket, Key, Body }).promise();

  const cksum = 11111111111;
  const errMsg = `Invalid checksum for S3 object s3://${Bucket}/${Key} with type cksum and expected sum ${cksum}`;
  await t.throws(aws.validateS3ObjectChecksum({
    algorithm: 'cksum', bucket: Bucket, key: Key, expectedSum: cksum
  }), errMsg);
  return aws.recursivelyDeleteS3Bucket(Bucket);
});
