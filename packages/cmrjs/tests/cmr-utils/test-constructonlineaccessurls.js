const test = require('ava');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');
const { BucketsConfig } = require('@cumulus/common');

const cmrUtils = rewire('../../cmr-utils');

const constructOnlineAccessUrls = cmrUtils.__get__('constructOnlineAccessUrls');
const getS3CredentialsObject = cmrUtils.__get__('getS3CredentialsObject');


const sortByURL = (a, b) => a.URL < b.URL;

const endpoint = 'https://endpoint';
const s3CredentialsEndpointObject = getS3CredentialsObject(`${endpoint}/s3credentials`);


test.beforeEach((t) => {
  t.context.bucketConfig = {
    private: { name: randomId('private'), type: 'private' },
    protected: { name: randomId('protected'), type: 'protected' },
    public: { name: randomId('public'), type: 'public' }
  };
  t.context.buckets = new BucketsConfig(t.context.bucketConfig);
});

test('returns correct url for protected data', (t) => {
  const movedFiles = [
    {
      key: 'some/path/protected-file.hdf',
      bucket: t.context.bucketConfig.protected.name
    }
  ];
  const expected = [
    {
      URL: `${endpoint}/${t.context.bucketConfig.protected.name}/some/path/protected-file.hdf`,
      Description: 'File to download',
      URLDescription: 'File to download',
      Type: 'GET DATA'
    },
    s3CredentialsEndpointObject
  ];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint: endpoint,
    buckets: t.context.buckets
  });

  t.deepEqual(actual, expected);
});

test('Returns correct url object for public data.', (t) => {
  const publicBucketName = t.context.bucketConfig.public.name;
  const movedFiles = [
    {
      key: 'some/path/browse_image.jpg',
      bucket: publicBucketName
    }
  ];
  const expected = [
    {
      URL: `https://${publicBucketName}.s3.amazonaws.com/some/path/browse_image.jpg`,
      Description: 'File to download',
      URLDescription: 'File to download',
      Type: 'GET DATA'
    },
    s3CredentialsEndpointObject
  ];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint: endpoint,
    buckets: t.context.buckets
  });

  t.deepEqual(actual, expected);
});


test('Returns empty list for private data.', (t) => {
  const privateBucket = t.context.bucketConfig.private.name;
  const movedFiles = [
    {
      key: 'some/path/top/secretfile',
      bucket: privateBucket
    }
  ];
  const expected = [s3CredentialsEndpointObject];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint: endpoint,
    buckets: t.context.buckets
  });

  t.deepEqual(actual, expected);
});

test('returns an array of correct url objects given a list of moved files.', (t) => {
  const movedFiles = [
    {
      key: 'hidden/secretfile.gpg',
      bucket: t.context.bucketConfig.private.name
    },
    {
      key: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name
    },
    {
      key: 'another/path/protected.hdf',
      bucket: t.context.bucketConfig.protected.name
    }
  ];

  const expected = [
    {
      URL: `${endpoint}/${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      Description: 'File to download',
      URLDescription: 'File to download',
      Type: 'GET DATA'
    },
    {
      URL: `https://${t.context.bucketConfig.public.name}.s3.amazonaws.com/path/publicfile.jpg`,
      Description: 'File to download',
      URLDescription: 'File to download',
      Type: 'GET DATA'
    },
    s3CredentialsEndpointObject
  ];

  const actual = constructOnlineAccessUrls({
    files: movedFiles,
    distEndpoint: endpoint,
    buckets: t.context.buckets
  });

  t.deepEqual(actual.sort(sortByURL), expected.sort(sortByURL));
});
