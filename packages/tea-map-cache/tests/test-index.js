'use strict';

const test = require('ava');
const proxyquire = require('proxyquire').noPreserveCache();

test('tea-map-cache handler writes the expected bucketmap', async (t) => {
  const { handler } = proxyquire('../index.js', {
    './tea': {
      getTeaBucketPath: async () => 'tea_bucket_path'
    },
    'aws-sdk': {
      S3: class mockedS3 {
        putObject(params) {
          return {
            promise: async () => {
              t.is(params.Body, '{"someBucket":"tea_bucket_path"}');
            }
          };
        }
      }
    }
  });
  process.env.TEA_API = 'https://foo/bar';
  await handler({
    bucketList: ['someBucket'], s3Bucket: 'fakeBucket', s3Key: 'fakeKey'
  });
});
