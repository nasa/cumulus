'use strict';

const test = require('ava');
const isEmpty = require('lodash/isEmpty');
const jsyaml = require('js-yaml');
const cryptoRandomString = require('crypto-random-string');
// const { randomId } = require('@cumulus/common/test-utils');
const { createBucket, s3PutObject, recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const {
  checkPrivateBucket,
  getBucketMap,
  getBucketDynamicPath,
  getPathsByBucketName,
  isPublicBucket,
} = require('../../lib/bucketMapUtils');

process.env.BUCKETNAME_PREFIX = 'bucketMap-prefix-';
process.env.stackName = cryptoRandomString({ length: 10 });
process.env.system_bucket = cryptoRandomString({ length: 10 });
process.env.BUCKET_MAP_FILE = `${process.env.stackName}/cumulus_distribution/bucket_map.yaml`;

const bucketMap = {
  MAP: {
    path1: {
      bucket: 'bucket-path-1',
      headers: {
        'Content-Type': 'text/plain',
      },
    },
    path2: {
      path2a: 'bucket-path-2a',
      path2b: 'bucket-has-2-paths',
    },
    path3: {
      path3a: {
        path3ai: 'bucket-path-3ai',
        path3aj: {
          bucket: 'bucket-has-2-paths',
        },
      },
    },
    'data-bucket': 'data-bucket',
  },
  PUBLIC_BUCKETS: {
    'bucket-path-2a': 'public bucket',
    'data-bucket/browse/jpg': 'Browse jpg image',
    'data-bucket/browse': 'Browse image',
  },
  PRIVATE_BUCKETS: {
    'data-bucket/pre-commission-data': [
      'internal_users',
      'external_team',
    ],
    'data-bucket/pre-commission-data/criticaldata': [
      'internal_users',
    ],
  },
};

test.before(async () => {
  await createBucket(process.env.system_bucket);
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: process.env.BUCKET_MAP_FILE,
    Body: jsyaml.dump(bucketMap),
  });
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('getBucketMap reads bucketMap from s3', async (t) => {
  const s3BucketMap = await getBucketMap();
  t.deepEqual(s3BucketMap, bucketMap);
});

test('getBucketDynamicPath finds the bucket when path exists in bucket map and there are no additional bucket and header fields', (t) => {
  const pathParts = ['path2', 'path2a', 'morepath', 'fileid'];
  const { bucket, path, key, headers } = getBucketDynamicPath(pathParts, bucketMap);
  t.is(bucket, `${process.env.BUCKETNAME_PREFIX}bucket-path-2a`);
  t.is(path, 'path2/path2a');
  t.is(key, 'morepath/fileid');
  t.true(isEmpty(headers));
});

test('getBucketDynamicPath finds the bucket when path exists in bucket map and there are bucket and header fields', (t) => {
  const pathParts = ['path1', 'path1a', 'morepath', 'fileid'];
  const { bucket, path, key, headers } = getBucketDynamicPath(pathParts, bucketMap);
  t.is(bucket, `${process.env.BUCKETNAME_PREFIX}bucket-path-1`);
  t.is(path, 'path1');
  t.is(key, 'path1a/morepath/fileid');
  t.deepEqual(headers, { 'Content-Type': 'text/plain' });
});

test('getBucketDynamicPath matches the longest path when there are multiple matching paths', (t) => {
  // this probably is not a valid bucket map, but just for testing
  const fakeBucketMap = {
    MAP: {
      path2: {
        bucket: 'bucket-path-1',
        headers: {
          'Content-Type': 'text/plain',
        },
        path2a: 'bucket-path-2a',
      },
    },
  };
  const pathParts = ['path2', 'path2a', 'morepath', 'fileid'];
  const { bucket, path, key, headers } = getBucketDynamicPath(pathParts, fakeBucketMap);
  t.is(bucket, `${process.env.BUCKETNAME_PREFIX}bucket-path-2a`);
  t.is(path, 'path2/path2a');
  t.is(key, 'morepath/fileid');
  t.true(isEmpty(headers));
});

test('getBucketDynamicPath returns empty object when no matching path found in bucket map', (t) => {
  const pathParts = ['path2', 'nonexistpath', 'morepath', 'fileid'];
  const bucketPath = getBucketDynamicPath(pathParts, bucketMap);
  t.true(isEmpty(bucketPath));
});

test('getBucketDynamicPath returns empty object when there is no mapping defined in bucket map', (t) => {
  const pathParts = ['path1', 'morepath', 'fileid'];
  const bucketPath = getBucketDynamicPath(pathParts, {});
  t.true(isEmpty(bucketPath));
});

test('checkPrivateBucket returns usergroups when the bucket is listed as private', (t) => {
  const bucket = `${process.env.BUCKETNAME_PREFIX}data-bucket`;
  const object = 'pre-commission-data/morepath/fileid';
  const userGroups = checkPrivateBucket(bucketMap, bucket, object);
  t.deepEqual(userGroups, ['internal_users', 'external_team']);
});

test('checkPrivateBucket matches the bucket with longest path', (t) => {
  const bucket = `${process.env.BUCKETNAME_PREFIX}data-bucket`;
  const object = 'pre-commission-data/criticaldata/fileid';
  const userGroups = checkPrivateBucket(bucketMap, bucket, object);
  t.deepEqual(userGroups, ['internal_users']);
});

test('checkPrivateBucket returns undefined when there is no matching private bucket found', (t) => {
  const bucket = `${process.env.BUCKETNAME_PREFIX}data-bucket`;
  const object = 'post-commission-data/morepath/fileid';
  const userGroups = checkPrivateBucket(bucketMap, bucket, object);
  t.is(userGroups, undefined);
});

test('checkPrivateBucket returns undefined when there are no private buckets defined in bucket map', (t) => {
  const bucket = `${process.env.BUCKETNAME_PREFIX}data-bucket`;
  const object = 'post-commission-data/morepath/fileid';
  const userGroups = checkPrivateBucket({}, bucket, object);
  t.is(userGroups, undefined);
});

test('isPublicBucket returns true when the bucket is listed as public', (t) => {
  const bucket = `${process.env.BUCKETNAME_PREFIX}bucket-path-2a`;
  const object = 'morepath/fileid';
  const isPublic = isPublicBucket(bucketMap, bucket, object);
  t.true(isPublic);
});

test('isPublicBucket matches the bucket with longest path', (t) => {
  const bucket = `${process.env.BUCKETNAME_PREFIX}data-bucket`;
  const object = 'browse/jpg/fileid';
  const isPublic = isPublicBucket(bucketMap, bucket, object);
  t.true(isPublic);
});

test('isPublicBucket returns false when there is no matching bucket found', (t) => {
  const bucket = `${process.env.BUCKETNAME_PREFIX}data-bucket`;
  const object = 'qa/morepath/fileid';
  const isPublic = isPublicBucket(bucketMap, bucket, object);
  t.false(isPublic);
});

test('isPublicBucket returns false when there are no public buckets defined in bucket map', (t) => {
  const bucket = `${process.env.BUCKETNAME_PREFIX}bucket-path-2a`;
  const object = 'morepath/fileid';
  const isPublic = isPublicBucket({}, bucket, object);
  t.false(isPublic);
});

test('getPathsByBucketName returns list of paths from bucket map', (t) => {
  const pathsFound = getPathsByBucketName(bucketMap, 'bucket-has-2-paths');
  const expectedPaths = ['path2/path2b', 'path3/path3a/path3aj'];
  t.deepEqual(pathsFound, expectedPaths);
});

test('getPathsByBucketName returns empty array when bucket is not found in bucket map', (t) => {
  const pathsFound = getPathsByBucketName(bucketMap, 'nonexistbucket');
  t.true(isEmpty(pathsFound));
});
