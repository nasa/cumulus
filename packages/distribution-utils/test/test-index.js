'use strict';

const test = require('ava');

const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { InvalidArgument, MissingBucketMap, MissingRequiredEnvVarError } = require('@cumulus/errors');

const {
  constructDistributionUrl,
  getDistributionBucketMapKey,
  fetchDistributionBucketMap,
  fetchDistributionTypedBucketMap,
  resolveDistributionEndpoint,
} = require('..');

test.before(async (t) => {
  t.context.stackName = 'distro-utils-stack';
  t.context.system_bucket = 'distro-utils-bucket';

  t.context.fileBucket = 'abcd1234';
  t.context.fileKey = 'coll123/granABC';
  t.context.distEndpoint = 'http://d111111abcdef8.cloudfront.net/';
  t.context.bucketMap = {
    abcd1234: {
      name: 'prod1A2B',
      type: 'public',
    },
  };
  t.context.unTypedBucketMap = Object.fromEntries(Object.entries(t.context.bucketMap).map(([key, value]) => [key, value.name]))
  await createBucket(t.context.system_bucket);
  await putJsonS3Object(
    t.context.system_bucket,
    `${t.context.stackName}/distribution_bucket_map.json`,
    t.context.bucketMap
  );
});

test.afterEach.always(() => {
  delete process.env.stackName;
  delete process.env.system_bucket;
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.system_bucket);
});

test('constructDistributionUrl returns distribution URL', (t) => {
  const {
    fileBucket,
    fileKey,
    distEndpoint,
    bucketMap,
  } = t.context;
  t.is(
    constructDistributionUrl(fileBucket, fileKey, bucketMap, distEndpoint),
    'http://d111111abcdef8.cloudfront.net/public/coll123/granABC'
  );
});

test('constructDistributionUrl correctly handles distributionEndpoint without a trailing slash', (t) => {
  const {
    fileBucket,
    fileKey,
    bucketMap,
  } = t.context;
  t.is(
    constructDistributionUrl(fileBucket, fileKey, bucketMap, 'http://d111111abcdef8.cloudfront.net'),
    'http://d111111abcdef8.cloudfront.net/public/coll123/granABC'
  );
});

test('constructDistributionUrl throws error if no bucketPath can be found', (t) => {
  const {
    fileBucket,
    fileKey,
    distEndpoint,
  } = t.context;
  t.throws(
    () => constructDistributionUrl(fileBucket, fileKey, {}, distEndpoint),
    {
      instanceOf: MissingBucketMap,
    }
  );
});

test('constructDistributionUrl throws error if distEndpoint is undefined', (t) => {
  const {
    fileBucket,
    fileKey,
    bucketMap,
  } = t.context;
  t.throws(
    () => constructDistributionUrl(fileBucket, fileKey, bucketMap),
    {
      instanceOf: InvalidArgument,
    }
  );
});

test('getDistributionBucketMapKey returns expected path', (t) => {
  t.is(
    getDistributionBucketMapKey(t.context.stackName),
    `${t.context.stackName}/distribution_bucket_map.json`
  );
});

test('fetchDistributionBucketMap throws error if system bucket or stackname are undefined', async (t) => {
  await t.throwsAsync(
    fetchDistributionBucketMap,
    {
      instanceOf: MissingRequiredEnvVarError,
    }
  );
});
test('fetchDistributionBucketMap fetches bucket map with passed vars', async (t) => {
  const bucketMap = await fetchDistributionBucketMap(
    t.context.system_bucket,
    t.context.stackName
  );
  t.deepEqual(bucketMap, t.context.unTypedBucketMap);
});
test('fetchDistributionTypedBucketMap fetches bucket map with passed vars', async (t) => {
  const bucketMap = await fetchDistributionTypedBucketMap(
    t.context.system_bucket,
    t.context.stackName
  );
  t.deepEqual(bucketMap, t.context.bucketMap);
});

test.serial('fetchDistributionTypedBucketMap fetches bucket map with env vars', async (t) => {
  process.env.stackName = t.context.stackName;
  process.env.system_bucket = t.context.system_bucket;
  const bucketMap = await fetchDistributionTypedBucketMap();
  t.deepEqual(bucketMap, t.context.bucketMap);
});

test('resolveDistributionEndpoint returns mapped endpoint when cmrProvider is in map', (t) => {
  const endpointMap = {
    PROV1: 'https://prov1.example',
    PROV2: 'https://prov2.example',
  };
  t.is(
    resolveDistributionEndpoint('PROV1', endpointMap, 'https://default.example'),
    'https://prov1.example'
  );
});

test('resolveDistributionEndpoint falls back to defaultEndpoint when cmrProvider is not in map', (t) => {
  const endpointMap = { PROV1: 'https://prov1.example' };
  t.is(
    resolveDistributionEndpoint('UNKNOWN', endpointMap, 'https://default.example'),
    'https://default.example'
  );
});

test('resolveDistributionEndpoint falls back to defaultEndpoint when endpointMap is undefined', (t) => {
  t.is(
    resolveDistributionEndpoint('PROV1', undefined, 'https://default.example'),
    'https://default.example'
  );
});

test('resolveDistributionEndpoint falls back to defaultEndpoint when endpointMap is empty', (t) => {
  t.is(
    resolveDistributionEndpoint('PROV1', {}, 'https://default.example'),
    'https://default.example'
  );
});

test('resolveDistributionEndpoint falls back to defaultEndpoint when cmrProvider is undefined', (t) => {
  const endpointMap = { PROV1: 'https://prov1.example' };
  t.is(
    resolveDistributionEndpoint(undefined, endpointMap, 'https://default.example'),
    'https://default.example'
  );
});

test('resolveDistributionEndpoint throws InvalidArgument when no map entry and no default', (t) => {
  t.throws(
    () => resolveDistributionEndpoint('UNKNOWN', { PROV1: 'https://prov1.example' }, undefined),
    { instanceOf: InvalidArgument }
  );
});

test('resolveDistributionEndpoint throws InvalidArgument when cmrProvider undefined and no default', (t) => {
  t.throws(
    () => resolveDistributionEndpoint(undefined, undefined, undefined),
    { instanceOf: InvalidArgument }
  );
});
