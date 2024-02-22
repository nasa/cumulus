import sinon from 'sinon';
import anyTest, { TestFn } from 'ava';
import { Readable } from 'stream';
import * as S3 from '@cumulus/aws-client/S3';
import cryptoRandomString from 'crypto-random-string';
import { handler, addChecksumToGranuleFile } from '../src';

const randomString = () => cryptoRandomString({ length: 10 });

const test = anyTest as TestFn<{
  stubS3: { getObject: S3.GetObjectMethod }
}>;

test.before((t) => {
  t.context.stubS3 = {
    getObject: () => Promise.resolve({
      Body: Readable.from(['asdf']),
    }),
  };
});

test('addChecksumToGranuleFile() does not update a granule file if checksumType is set but checksum is not', async (t) => {
  const granuleFile = {
    bucket: 'bucket',
    key: 'key',
    checksumType: 'md5',
  };

  const result = await addChecksumToGranuleFile({
    s3: t.context.stubS3,
    algorithm: 'md5',
    granuleFile,
  });

  t.deepEqual(result, granuleFile);
});

test('addChecksumToGranuleFile() does not update a granule file if checksum is set but checksumType is not', async (t) => {
  const granuleFile = {
    bucket: 'bucket',
    key: 'key',
    checksum: 'asdf',
  };

  const result = await addChecksumToGranuleFile({
    s3: t.context.stubS3,
    algorithm: 'md5',
    granuleFile,
  });

  t.deepEqual(result, granuleFile);
});

test('addChecksumToGranuleFile() does not update a granule file if it does not have a filename', async (t) => {
  const granuleFile = {};

  const result = await addChecksumToGranuleFile({
    s3: t.context.stubS3,
    algorithm: 'md5',
    // @ts-expect-error
    granuleFile,
  });

  t.deepEqual(result, granuleFile);
});

test('addChecksumToGranuleFile() returns the file if checksumType and checksum are already set', async (t) => {
  const granuleFile = {
    bucket: 'bucket',
    key: 'key',
    checksumType: 'md5',
    checksum: 'asdf',
  };

  const result = await addChecksumToGranuleFile({
    s3: t.context.stubS3,
    algorithm: 'md5',
    granuleFile,
  });

  t.deepEqual(result, granuleFile);
});

test('addChecksumToGranuleFile() adds the checksumType and checksum to the file if they are missing', async (t) => {
  const granuleFile = {
    bucket: 'bucket',
    key: 'path/to/file.txt',
  };

  const fakeGetObject = sinon.fake.resolves({
    Body: Readable.from(['asdf']),
  });

  const result = await addChecksumToGranuleFile({
    s3: { getObject: fakeGetObject },
    algorithm: 'md5',
    granuleFile,
  });

  t.true(
    fakeGetObject.calledOnceWithExactly({
      Bucket: 'bucket',
      Key: 'path/to/file.txt',
    })
  );

  t.deepEqual(
    result,
    {
      ...granuleFile,
      checksumType: 'md5',
      checksum: '912ec803b2ce49e4a541068d495ab570',
    }
  );
});

test('The handler does not update files that already have a checksum', async (t) => {
  const event = {
    config: {
      algorithm: 'md5',
    },
    input: {
      granules: [
        {
          granuleId: 'g-1',
          files: [
            {
              bucket: 'bucket',
              key: 'key',
              checksumType: 'c-type',
              checksum: 'c-value',
            },
          ],
        },
      ],
    },
  };

  const result = await handler(event);

  t.is(result.granules[0].files[0].checksumType, 'c-type');
  t.is(result.granules[0].files[0].checksum, 'c-value');
});

test('The handler updates files that do not have a checksum', async (t) => {
  const bucket = randomString();

  await S3.createBucket(bucket);
  t.teardown(() => S3.recursivelyDeleteS3Bucket(bucket));

  const key = randomString();

  await S3.s3PutObject({
    Bucket: bucket,
    Key: key,
    Body: 'asdf',
  });

  const event = {
    config: {
      algorithm: 'md5',
    },
    input: {
      granules: [
        {
          granuleId: 'g-1',
          files: [
            { bucket, key },
          ],
        },
      ],
    },
  };

  const result = await handler(event);

  t.is(result.granules[0].files[0].checksumType, 'md5');
  t.is(result.granules[0].files[0].checksum, '912ec803b2ce49e4a541068d495ab570');
});

test('The handler preserves extra input properties', async (t) => {
  const event = {
    config: {
      algorithm: 'md5',
    },
    input: {
      foo: 'bar',
      granules: [
        {
          granuleId: 'g-1',
          files: [
            {
              bucket: 'bucket',
              key: 'key',
              checksumType: 'c-type',
              checksum: 'c-value',
            },
          ],
        },
      ],
    },
  };

  const result = await handler(event);

  t.is(result.foo, 'bar');
});

test('The handler preserves extra granule properties', async (t) => {
  const event = {
    config: {
      algorithm: 'md5',
    },
    input: {
      granules: [
        {
          granuleId: 'g-1',
          foo: 'bar',
          files: [
            {
              bucket: 'bucket',
              key: 'key',
              checksumType: 'c-type',
              checksum: 'c-value',
            },
          ],
        },
      ],
    },
  };

  const result = await handler(event);

  t.is(result.granules[0].foo, 'bar');
});

test('The handler preserves extra granule file properties', async (t) => {
  const event = {
    config: {
      algorithm: 'md5',
    },
    input: {
      granules: [
        {
          granuleId: 'g-1',
          files: [
            {
              foo: 'bar',
              bucket: 'bucket',
              key: 'key',
              checksumType: 'c-type',
              checksum: 'c-value',
            },
          ],
        },
      ],
    },
  };

  const result = await handler(event);

  t.is(result.granules[0].files[0].foo, 'bar');
});
