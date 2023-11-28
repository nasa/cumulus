'use strict';

const test = require('ava');
const proxyquire = require('proxyquire').noPreserveCache();

test('tea-map-cache handler writes the expected bucketmap', async (t) => {
  const { handler } = proxyquire('../dist/src', {
    './tea': {
      getTeaBucketPath: () => Promise.resolve('tea_bucket_path'),
    },
    '@cumulus/aws-client/S3': {
      s3PutObject:
        (params) => Promise.resolve(t.is(params.Body, '{"someBucket":"tea_bucket_path"}')),
    },
  });
  process.env.TEA_API = 'https://foo/bar';
  await handler({
    bucketList: ['someBucket'], s3Bucket: 'fakeBucket', s3Key: 'fakeKey',
  });
});
