'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { tmpdir } = require('os');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const pTimeout = require('p-timeout');
const { Readable } = require('stream');
const { promisify } = require('util');

const { UnparsableFileLocationError } = require('@cumulus/errors');

const {
  createBucket,
  getJsonS3Object,
  getObjectSize,
  getS3Object,
  getTextObject,
  headObject,
  downloadS3File,
  listS3ObjectsV2,
  recursivelyDeleteS3Bucket,
  s3Join,
  validateS3ObjectChecksum,
  getFileBucketAndKey,
  putFile,
  calculateObjectHash,
  getObjectReadStream,
  streamS3Upload,
  getObjectStreamContents,
  uploadS3FileStream,
  deleteS3Objects,
  promiseS3Upload,
  fileExists,
  s3ObjectExists,
} = require('../S3');
const awsServices = require('../services');
const { streamToString } = require('../test-utils');

const mkdtemp = promisify(fs.mkdtemp);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

// Not using @cumulus/common/sleep() because adding @cumulus/common as a dependency introduces a
// circular dependency.
const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

const randomString = () => cryptoRandomString({ length: 10 });

const stageTestObjectToLocalStack = (bucket, body, key = randomString()) =>
  awsServices.s3().putObject({ Bucket: bucket, Key: key, Body: body })
    .then(({ ETag }) => ({ ETag, Key: key }));

test.before(async (t) => {
  t.context.Bucket = randomString();

  await createBucket(t.context.Bucket);
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.Bucket);
});

test('getTextObject() returns the contents of an S3 object', async (t) => {
  const { Bucket } = t.context;
  const { Key } = await stageTestObjectToLocalStack(Bucket, 'asdf');

  t.is(await getTextObject(Bucket, Key), 'asdf');
});

test('getJsonS3Object() returns the JSON-parsed contents of an S3 object', async (t) => {
  const { Bucket } = t.context;

  const { Key } = await stageTestObjectToLocalStack(
    Bucket,
    JSON.stringify({ a: 1 })
  );

  t.deepEqual(await getJsonS3Object(Bucket, Key), { a: 1 });
});

test('createBucket() creates a bucket', async (t) => {
  const bucketName = randomString();
  await createBucket(bucketName);

  try {
    await t.notThrowsAsync(
      awsServices.s3().headBucket({ Bucket: bucketName })
    );
  } finally {
    await awsServices.s3().deleteBucket({ Bucket: bucketName });
  }
});

test('deleteS3Objects() deletes s3 objects', async (t) => {
  const bucketName = randomString();
  await createBucket(bucketName);

  t.plan(2);

  try {
    const { Key: key1 } = await stageTestObjectToLocalStack(bucketName, 'asdf');
    const { Key: key2 } = await stageTestObjectToLocalStack(bucketName, 'foobar');

    const objects1 = await listS3ObjectsV2({
      Bucket: bucketName,
    });
    t.is(objects1.length, 2);

    await deleteS3Objects({
      client: awsServices.s3(),
      bucket: bucketName,
      keys: [key1, key2],
    });

    const objects2 = await listS3ObjectsV2({
      Bucket: bucketName,
    });
    t.is(objects2.length, 0);
  } finally {
    await awsServices.s3().deleteBucket({ Bucket: bucketName });
  }
});

test('putFile() uploads a file to S3', async (t) => {
  const tmpDir = await mkdtemp(`${os.tmpdir()}${path.sep}`);
  const sourceFile = path.join(tmpDir, 'asdf');
  const key = randomString();

  try {
    await writeFile(sourceFile, 'asdf');
    await putFile(t.context.Bucket, key, sourceFile);
  } finally {
    await unlink(sourceFile);
    await rmdir(tmpDir);
  }

  const fetchedFile = await getS3Object(t.context.Bucket, key);
  t.is(await getObjectStreamContents(fetchedFile.Body), 'asdf');
});

test('getS3Object() returns an existing S3 object', async (t) => {
  const { Bucket } = t.context;

  const { Key } = await stageTestObjectToLocalStack(Bucket, 'asdf');

  const response = await getS3Object(Bucket, Key);
  t.is(await getObjectStreamContents(response.Body), 'asdf');
});

test('getS3Object() immediately throws an exception if the requested bucket does not exist', async (t) => {
  const promisedGetS3Object = getS3Object(randomString(), 'asdf');
  const err = await t.throwsAsync(pTimeout(promisedGetS3Object, 5000));
  t.is(err.name, 'NoSuchBucket');
});

test('getS3Object() throws an exception if the requested key does not exist', async (t) => {
  const { Bucket } = t.context;

  const err = await t.throwsAsync(
    getS3Object(Bucket, 'does-not-exist', { retries: 1 })
  );
  t.is(err.name, 'NoSuchKey');
});

test('getS3Object() immediately throws an exception if the requested key does not exist', async (t) => {
  const { Bucket } = t.context;

  const promisedGetS3Object = getS3Object(Bucket, 'asdf');

  const err = await t.throwsAsync(pTimeout(promisedGetS3Object, 5000));

  t.is(err.name, 'NoSuchKey');
});

test('getS3Object() will retry if the requested key does not exist', async (t) => {
  const { Bucket } = t.context;
  const Key = randomString();

  const promisedGetS3Object = getS3Object(Bucket, Key, { retries: 5 });
  await sleep(3000)
    .then(() => awsServices.s3().putObject({ Bucket, Key, Body: 'asdf' }))
    .catch(console.log);

  const response = await promisedGetS3Object;

  t.is(await getObjectStreamContents(response.Body), 'asdf');
});

test('s3Join behaves as expected', (t) => {
  // Handles an array argument
  t.is(s3Join(['a', 'b', 'c']), 'a/b/c');

  t.is(s3Join(['a', 'b']), 'a/b');
  t.is(s3Join(['a', 'b/']), 'a/b/');
  t.is(s3Join(['a/', 'b']), 'a/b');
  t.is(s3Join(['/a', 'b']), 'a/b');
  t.is(s3Join(['a/', 'b']), 'a/b');

  t.is(s3Join(['a']), 'a');
  t.is(s3Join(['/a']), 'a');
  t.is(s3Join(['a/']), 'a/');

  // Handles a list of arguments
  t.is(s3Join('a', 'b'), 'a/b');
});

test('listS3ObjectsV2 handles non-truncated case', async (t) => {
  const Bucket = randomString();
  await createBucket(Bucket);

  await Promise.all(['a', 'b', 'c'].map((Key) => awsServices.s3().putObject({
    Bucket,
    Key,
    Body: 'my-body',
  })));

  // List things from S3
  const result = await listS3ObjectsV2({ Bucket, MaxKeys: 5 });
  const actualKeys = new Set(result.map((object) => object.Key));
  const expectedKeys = new Set(['a', 'b', 'c']);

  t.deepEqual(actualKeys, expectedKeys);

  return recursivelyDeleteS3Bucket(Bucket);
});

test('listS3ObjectsV2 handles truncated case', async (t) => {
  const Bucket = randomString();
  await createBucket(Bucket);

  await Promise.all(['a', 'b', 'c'].map((Key) => awsServices.s3().putObject({
    Bucket,
    Key,
    Body: 'my-body',
  })));

  // List things from S3
  const result = await listS3ObjectsV2({ Bucket, MaxKeys: 2 });
  const actualKeys = new Set(result.map((object) => object.Key));
  const expectedKeys = new Set(['a', 'b', 'c']);

  t.deepEqual(actualKeys, expectedKeys);

  return recursivelyDeleteS3Bucket(Bucket);
});

test('downloadS3File rejects promise if key not found', async (t) => {
  const Bucket = randomString();
  await createBucket(Bucket);

  try {
    await downloadS3File({ Bucket, Key: 'not-gonna-find-it' }, '/tmp/wut');
  } catch (error) {
    t.is(error.message, 'The specified key does not exist.');
  }
});

test('downloadS3File resolves filepath if key is found', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';

  await createBucket(Bucket);
  await awsServices.s3().putObject({ Bucket, Key: Key, Body: Body });

  const params = { Bucket, Key: Key };
  const filepath = await downloadS3File(params, path.join(tmpdir(), 'example'));

  const result = await new Promise((resolve, reject) => {
    fs.readFile(filepath, 'utf-8', (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  t.is(result, Body);
});

test('validateS3ObjectChecksum returns true for good checksum', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';

  await createBucket(Bucket);
  await awsServices.s3().putObject({ Bucket, Key, Body });

  const cksum = 148323542;
  const ret = await validateS3ObjectChecksum({
    algorithm: 'cksum', bucket: Bucket, key: Key, expectedSum: cksum,
  });
  t.true(ret);
  return recursivelyDeleteS3Bucket(Bucket);
});

test('validateS3ObjectChecksum throws InvalidChecksum error on bad checksum', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';

  await createBucket(Bucket);
  await awsServices.s3().putObject({ Bucket, Key, Body });

  const cksum = 11111111111;

  await t.throwsAsync(
    validateS3ObjectChecksum({
      algorithm: 'cksum', bucket: Bucket, key: Key, expectedSum: cksum,
    }),
    {
      message: `Invalid checksum for S3 object s3://${Bucket}/${Key} with type cksum and expected sum ${cksum}`,
    }
  );

  return recursivelyDeleteS3Bucket(Bucket);
});

test('getFileBucketAndKey parses bucket and key', (t) => {
  const pathParams = 'test-bucket/path/key.txt';

  const [bucket, key] = getFileBucketAndKey(pathParams);

  t.is(bucket, 'test-bucket');
  t.is(key, 'path/key.txt');
});

test('getFileBucketAndKey throws UnparsableFileLocationError if location cannot be parsed', (t) => {
  const pathParams = 'test-bucket';

  t.throws(
    () => getFileBucketAndKey(pathParams),
    { instanceOf: UnparsableFileLocationError }
  );
});

test('headObject() will retry if the requested key does not exist', async (t) => {
  const { Bucket } = t.context;
  const Key = randomString();

  const promisedHeadObject = headObject(Bucket, Key, { retries: 5 });
  await sleep(3000)
    .then(() => awsServices.s3().putObject({ Bucket, Key, Body: 'asdf' }));

  await t.notThrowsAsync(promisedHeadObject);
});

test('getObjectReadStream() returns a readable stream for the requested object', async (t) => {
  const { Key: key } = await stageTestObjectToLocalStack(t.context.Bucket, 'asdf');

  const s3 = awsServices.s3();

  const stream = await getObjectReadStream({ s3, bucket: t.context.Bucket, key });

  const result = await streamToString(stream);

  t.is(result, 'asdf');
});

test('calculateObjectHash() calculates the correct hash', async (t) => {
  const key = 'expected-key';

  let getObjectCallCount = 0;

  const stubS3 = {
    getObject: (params = {}) => {
      getObjectCallCount += 1;

      t.is(params.Bucket, t.context.Bucket);
      t.is(params.Key, key);

      return {
        Body: Readable.from(['asdf']),
      };
    },
  };

  const hash = await calculateObjectHash({
    s3: stubS3,
    bucket: t.context.Bucket,
    key,
    algorithm: 'md5',
  });

  t.is(getObjectCallCount, 1);

  t.is(hash, '912ec803b2ce49e4a541068d495ab570');
});

test('getObjectSize() returns the size of an object', async (t) => {
  const { Bucket } = t.context;
  const key = randomString();

  await awsServices.s3().putObject({
    Bucket,
    Key: key,
    Body: 'asdf',
  });

  const objectSize = await getObjectSize({
    s3: awsServices.s3(),
    bucket: Bucket,
    key,
  });

  t.is(objectSize, 4);
});

test('streamS3Upload() uploads contents of stream to S3', async (t) => {
  const tmpDir = await mkdtemp(`${os.tmpdir()}${path.sep}`);
  const sourceFile = path.join(tmpDir, randomString());
  const sourceData = randomString();
  const key = randomString();

  await writeFile(sourceFile, sourceData);
  t.teardown(async () => {
    await unlink(sourceFile);
    await rmdir(tmpDir);
  });

  await streamS3Upload(
    fs.createReadStream(sourceFile),
    {
      params: {
        Bucket: t.context.Bucket,
        Key: key,
        ContentType: 'plaintext',
      },
    }
  );
  const objectData = await getTextObject(
    t.context.Bucket,
    key
  );
  t.is(objectData, sourceData);
});

test('streamS3Upload() throws error if upload stream errors', async (t) => {
  const sourceFile = `non-existent-path${randomString()}`;
  const key = randomString();
  await t.throwsAsync(
    streamS3Upload(
      fs.createReadStream(sourceFile),
      {
        params: {
          Bucket: t.context.Bucket,
          Key: key,
          ContentType: 'plaintext',
        },
      }
    ),
    { message: /ENOENT: no such file or directory/ }
  );
});

test('uploadS3FileStream() respects S3 configuration parameters', async (t) => {
  const readStream = fs.createReadStream('/dev/urandom', { end: 5 });
  const key = cryptoRandomString({ length: 5 });
  const contentType = 'application/json';
  await uploadS3FileStream(
    readStream,
    t.context.Bucket,
    key,
    {
      ContentType: contentType,
    }
  );
  const object = await headObject(t.context.Bucket, key);
  t.is(object.ContentType, 'application/json');
});

test('promiseS3Upload() works and returns expected parameters', async (t) => {
  const Key = cryptoRandomString({ length: 5 });
  const result = await promiseS3Upload({
    params: {
      Bucket: t.context.Bucket,
      Key,
      Body: cryptoRandomString({ length: 5 }),
    },
  });
  t.truthy(result.ETag);
});

test('fileExists() correctly returns head object response for existing file', async (t) => {
  const { Bucket } = t.context;

  const { Key } = await stageTestObjectToLocalStack(Bucket, 'asdf');
  const fileExistsResponse = await fileExists(Bucket, Key);
  const headObjectResponse = await headObject(Bucket, Key);
  t.deepEqual(
    headObjectResponse,
    {
      ...fileExistsResponse,
      $metadata: headObjectResponse.$metadata,
    }
  );
});

test('fileExists() correctly returns false for non-existent file', async (t) => {
  const { Bucket } = t.context;
  t.false(await fileExists(Bucket, randomString()));
});

test('s3ObjectExists() returns true for existing file', async (t) => {
  const { Bucket } = t.context;

  const { Key } = await stageTestObjectToLocalStack(Bucket, 'asdf');
  t.true(await s3ObjectExists({ Bucket, Key }));
});

test('s3ObjectExists() returns false for non-existent file', async (t) => {
  const { Bucket } = t.context;
  t.false(await s3ObjectExists({ Bucket, Key: randomString() }));
  t.false(await s3ObjectExists({ Bucket: randomString(), Key: randomString() }));
});
