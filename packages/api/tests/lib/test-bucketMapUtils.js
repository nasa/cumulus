'use strict';

const test = require('ava');
const isEmpty = require('lodash/isEmpty');
const {
  checkPrivateBucket,
  checkPublicBucket,
  getBucketMap,
  getBucketDynamicPath,
  processRequest,
} = require('../../lib/bucketMapUtils');
const { randomId } = require('@cumulus/common/test-utils');

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
      path2b: 'bucket-path-2b',
    },
    path3: {
      path3a: {
        path3ai: 'bucket-path-3ai',
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
    'data-bucket/pre-commission-data/critialdata': [
      'internal_users',
    ],
  },
};

test('getBucketDynamicPath finds the bucket when path exists in bucket map and there are no additional bucket and header fields', (t) => {
  const pathParts = ['path2', 'path2b', 'morepath', 'fileid'];
  const { bucket, path, key, headers } = getBucketDynamicPath(pathParts, bucketMap);
  t.is(bucket, 'bucket-path-2b');
  t.is(path, 'path2/path2b');
  t.is(key, 'morepath/fileid');
  t.true(isEmpty(headers));
});

test('getBucketDynamicPath finds the bucket when path exists in bucket map and there are bucket and header fields', (t) => {
  const pathParts = ['path1', 'path1a', 'morepath', 'fileid'];
  const { bucket, path, key, headers } = getBucketDynamicPath(pathParts, bucketMap);
  t.is(bucket, 'bucket-path-1');
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
        path2b: 'bucket-path-2b',
      },
    },
  };
  const pathParts = ['path2', 'path2a', 'morepath', 'fileid'];
  const { bucket, path, key, headers } = getBucketDynamicPath(pathParts, fakeBucketMap);
  t.is(bucket, 'bucket-path-2a');
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

test('checkPrivateBucket returns usergroups when the bucket is listed as private ', (t) => {
  const bucket = 'data-bucket';
  const object = 'pre-commission-data/morepath/fileid';
  const userGroups = checkPrivateBucket(bucket, bucketMap, object);
  t.deepEqual(userGroups, ['internal_users', 'external_team']);
});

test('checkPrivateBucket matches the bucket with longest path', (t) => {
  const bucket = 'data-bucket';
  const object = 'pre-commission-data/critialdata/fileid';
  const userGroups = checkPrivateBucket(bucket, bucketMap, object);
  t.deepEqual(userGroups, ['internal_users']);
});

test('checkPrivateBucket returns empty array when there is no matching bucket found', (t) => {
  const bucket = 'data-bucket';
  const object = 'post-commission-data/morepath/fileid';
  const userGroups = checkPrivateBucket(bucket, bucketMap, object);
  t.true(isEmpty(userGroups));
});

test('checkPrivateBucket returns empty array when there are no private buckets in bucket map', (t) => {
  const bucket = 'data-bucket';
  const object = 'post-commission-data/morepath/fileid';
  const userGroups = checkPrivateBucket(bucket, {}, object);
  t.true(isEmpty(userGroups));
});

test('checkPublicBucket returns true when the bucket is listed as public ', (t) => {
  const bucket = 'bucket-path-2a';
  const object = 'morepath/fileid';
  const isPublic = checkPublicBucket(bucket, bucketMap, object);
  t.true(isPublic);
});

test('checkPublicBucket matches the bucket with longest path ', (t) => {
  const bucket = 'data-bucket';
  const object = 'browse/jpg/fileid';
  const isPublic = checkPublicBucket(bucket, bucketMap, object);
  t.true(isPublic);
});

test('checkPublicBucket returns empty array when there is no matching bucket found', (t) => {
  const bucket = 'data-bucket';
  const object = 'qa/morepath/fileid';
  const isPublic = checkPublicBucket(bucket, bucketMap, object);
  t.false(isPublic);
});

test('checkPublicBucket returns empty array when there are public buckets in bucket map', (t) => {
  const bucket = 'bucket-path-2a';
  const object = 'morepath/fileid';
  const isPublic = checkPublicBucket(bucket, {}, object);
  t.false(isPublic);
});
