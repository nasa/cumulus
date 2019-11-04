'use strict';

const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');
const test = require('ava');
const sinon = require('sinon');
const pTimeout = require('p-timeout');

const aws = require('../aws');
const { UnparsableFileLocationError } = require('../errors.js');
const { randomString, throttleOnce } = require('../test-utils');
const { sleep } = require('../util');

test('toSfnExecutionName() truncates names to 80 characters', (t) => {
  t.is(
    aws.toSfnExecutionName(
      [
        '123456789_123456789_123456789_123456789_',
        '123456789_123456789_123456789_123456789_'
      ],
      ''
    ),
    '123456789_123456789_123456789_123456789_123456789_123456789_123456789_123456789_'
  );
});

test('toSfnExecutionName() joins fields by the given delimiter', (t) => {
  t.is(
    aws.toSfnExecutionName(['a', 'b', 'c'], '-'),
    'a-b-c'
  );
});

test('toSfnExecutionName() escapes occurrences of the delimiter in fields', (t) => {
  t.is(
    aws.toSfnExecutionName(['a', 'b-c', 'd'], '-'),
    'a-b!u002dc-d'
  );
});

test('toSfnExecutionName() escapes unsafe characters with unicode-like escape codes', (t) => {
  t.is(
    aws.toSfnExecutionName(['a', 'b$c', 'd'], '-'),
    'a-b!u0024c-d'
  );
});

test('toSfnExecutionName() escapes exclammation points (used for escape codes)', (t) => {
  t.is(
    aws.toSfnExecutionName(['a', 'b!c', 'd'], '-'),
    'a-b!u0021c-d'
  );
});

test('toSfnExecutionName() does not escape safe characters', (t) => {
  t.is(
    aws.toSfnExecutionName(['a', 'b.+-_=', 'c'], 'z'),
    'azb.+-_=zc'
  );
});

test('fromSfnExecutionName() returns fields separated by the given delimiter', (t) => {
  t.deepEqual(
    aws.fromSfnExecutionName('a-b-c', '-'),
    ['a', 'b', 'c']
  );
});

test('fromSfnExecutionName() interprets bang-escaped unicode in the input string', (t) => {
  t.deepEqual(
    aws.fromSfnExecutionName('a-b!u002dc-d', '-'),
    ['a', 'b-c', 'd']
  );
});

test('fromSfnExecutionName() copes with quotes in the input string', (t) => {
  t.deepEqual(
    aws.fromSfnExecutionName('foo"bar'),
    ['foo"bar']
  );
});

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
  } catch (err) {
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

test.serial('pullStepFunctionEvent returns message from S3 to target', async (t) => {
  const expectedMessage = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    payload: {
      someKey: 'some data'
    }
  };

  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    payload: {},
    replace: {
      Bucket: 'test bucket',
      Key: 'key',
      TargetPath: '$.payload'
    }
  };

  const stub = sinon.stub(aws, 'getS3Object').resolves({
    Body: JSON.stringify({ someKey: 'some data' })
  });
  try {
    const message = await aws.pullStepFunctionEvent(event);
    t.deepEqual(message, expectedMessage);
  } finally {
    stub.restore();
  }
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
  } finally {
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
  } catch (err) {
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

  await t.throwsAsync(
    () => aws.validateS3ObjectChecksum({
      algorithm: 'cksum', bucket: Bucket, key: Key, expectedSum: cksum
    }),
    `Invalid checksum for S3 object s3://${Bucket}/${Key} with type cksum and expected sum ${cksum}`
  );

  return aws.recursivelyDeleteS3Bucket(Bucket);
});

test('getFileBucketAndKey parses bucket and key', (t) => {
  const pathParams = 'test-bucket/path/key.txt';

  const [bucket, key] = aws.getFileBucketAndKey(pathParams);

  t.is(bucket, 'test-bucket');
  t.is(key, 'path/key.txt');
});

test('getFileBucketAndKey throws UnparsableFileLocationError if location cannot be parsed', (t) => {
  const pathParams = 'test-bucket';

  t.throws(
    () => aws.getFileBucketAndKey(pathParams),
    UnparsableFileLocationError
  );
});

test('sqsQueueExists detects if the queue does not exist or is not accessible', async (t) => {
  const queueUrl = await aws.createQueue(randomString());
  const queueName = queueUrl.split('/').pop();
  t.true(await aws.sqsQueueExists(queueUrl));
  t.true(await aws.sqsQueueExists(queueName));
  t.false(await aws.sqsQueueExists(randomString()));
  await aws.sqs().deleteQueue({ QueueUrl: queueUrl }).promise();
});

test('getS3Object() returns an existing S3 object', async (t) => {
  const Bucket = randomString();
  const Key = randomString();

  try {
    await aws.s3().createBucket({ Bucket }).promise();
    await aws.s3().putObject({ Bucket, Key, Body: 'asdf' }).promise();

    const response = await aws.getS3Object(Bucket, Key);
    t.is(response.Body.toString(), 'asdf');
  } finally {
    await aws.recursivelyDeleteS3Bucket(Bucket);
  }
});

test('getS3Object() immediately throws an exception if the requested bucket does not exist', async (t) => {
  const promisedGetS3Object = aws.getS3Object(
    randomString(),
    'asdf'
  );
  const err = await t.throwsAsync(pTimeout(promisedGetS3Object, 5000));
  t.is(err.code, 'NoSuchBucket');
});

test('getS3Object() throws an exception if the requested key does not exist', async (t) => {
  const Bucket = randomString();

  try {
    await aws.s3().createBucket({ Bucket }).promise();

    const err = await t.throwsAsync(
      () => aws.getS3Object(
        Bucket,
        'does-not-exist',
        { retries: 1 }
      )
    );
    t.is(err.code, 'NoSuchKey');
  } finally {
    await aws.recursivelyDeleteS3Bucket(Bucket);
  }
});

test('getS3Object() retries if the requested key does not exist', async (t) => {
  const Bucket = randomString();
  const Key = randomString();

  try {
    await aws.s3().createBucket({ Bucket }).promise();

    const promisedGetS3Object = aws.getS3Object(Bucket, Key);
    await sleep(5000)
      .then(() => aws.s3().putObject({ Bucket, Key, Body: 'asdf' }).promise());

    const response = await promisedGetS3Object;

    t.is(response.Body.toString(), 'asdf');
  } finally {
    await aws.recursivelyDeleteS3Bucket(Bucket);
  }
});

test.only('getS3Object() immediately throws an exception if retries are set to 0', async (t) => {
  const Bucket = randomString();

  try {
    await aws.s3().createBucket({ Bucket }).promise();

    const promisedGetS3Object = aws.getS3Object(
      Bucket,
      'asdf',
      { retries: 0 }
    );

    const err = await t.throwsAsync(pTimeout(promisedGetS3Object, 5000));

    t.is(err.code, 'NoSuchKey');
  } finally {
    await aws.recursivelyDeleteS3Bucket(Bucket);
  }
});
