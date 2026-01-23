import sinon from 'sinon';
import anyTest, { TestFn } from 'ava';
import { Readable } from 'stream';
import * as S3 from '@cumulus/aws-client/S3';
import cryptoRandomString from 'crypto-random-string';
import * as crypto from 'crypto';

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

const makeRangeS3Mock = (full: Buffer) => ({
  getObject: sinon.fake(async ({ Range }: any) => {
    const [, startStr, endStr] = /bytes=(\d+)-(\d+)/.exec(Range) ?? [];
    const start = Number(startStr);
    const end = Number(endStr);

    return { Body: Readable.from([full.subarray(start, end + 1)]) };
  }),
});

test('addChecksumToGranuleFile() does not update a granule file if checksumType is set but checksum is not', async (t) => {
  const granuleFile = {
    bucket: 'bucket',
    key: 'key',
    checksumType: 'md5',
    size: 123,
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
    size: 123,
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
    size: 123,
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
    size: 123,
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
              size: 123,
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

  const size = Buffer.byteLength('asdf');

  const event = {
    config: {
      algorithm: 'md5',
    },
    input: {
      granules: [
        {
          granuleId: 'g-1',
          files: [
            { bucket, key, size },
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
              size: 123,
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
              size: 123,
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
              size: 123,
            },
          ],
        },
      ],
    },
  };

  const result = await handler(event);

  t.is(result.granules[0].files[0].foo, 'bar');
});

test('addChecksumToGranuleFile() uses ranged GETs for large files and computes correct checksum', async (t) => {
  process.env.MULTIPART_CHECKSUM_THRESHOLD_MEGABYTES = '2'; // anything > 2 MB triggers multipart
  process.env.MULTIPART_CHECKSUM_PART_MEGABYTES = '1'; // 1 MB ranges

  // Ensure multiple ranges (4 MB)
  const full = Buffer.alloc(4 * 1024 * 1024, 'a');
  const s3 = makeRangeS3Mock(full);

  const result = await addChecksumToGranuleFile({
    s3: s3 as any,
    algorithm: 'md5',
    granuleFile: {
      bucket: 'bucket',
      key: 'key',
      size: full.length,
    } as any,
  });

  // It should have called getObject multiple times with Range
  const rangedCalls = (s3.getObject as any).getCalls().filter((c: any) => c.args[0].Range);

  // Verify ranges look correct
  t.true(rangedCalls.length > 1);
  t.is(result.checksumType, 'md5');
  t.is(result.checksum, crypto.createHash('md5').update(full).digest('hex'));
});
