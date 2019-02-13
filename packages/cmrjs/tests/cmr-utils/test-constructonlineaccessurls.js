const test = require('ava');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');
const { BucketsConfig } = require('@cumulus/common');

const cmrUtils = rewire('../../cmr-utils');

const constructOnlineAccessUrls = cmrUtils.__get__('constructOnlineAccessUrls');


const sortByURL = (a, b) => a.URL < b.URL;


test.beforeEach((t) => {
  t.context.bucketConfig = {
    private: { name: randomId('private'), type: 'private' },
    protected: { name: randomId('protected'), type: 'protected' },
    public: { name: randomId('public'), type: 'public' }
  };
  t.context.buckets = new BucketsConfig(t.context.bucketConfig);
});

test('returns correct url for protected data', (t) => {
  const endpoint = 'https://endpoint';
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
    }
  ];

  const actual = constructOnlineAccessUrls(movedFiles, endpoint, t.context.buckets);

  t.deepEqual(actual, expected);
});

test('Returns correct url object for public data.', (t) => {
  const endpoint = 'https://endpoint';
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
    }
  ];

  const actual = constructOnlineAccessUrls(movedFiles, endpoint, t.context.buckets);

  t.deepEqual(actual, expected);
});


test('Returns empty list for private data.', (t) => {
  const endpoint = 'https://endpoint';
  const privateBucket = t.context.bucketConfig.private.name;
  const movedFiles = [
    {
      key: 'some/path/top/secretfile',
      bucket: privateBucket
    }
  ];
  const expected = [];

  const actual = constructOnlineAccessUrls(movedFiles, endpoint, t.context.buckets);

  t.deepEqual(actual, expected);
});

test('returns an array of correct url objects given a list of moved files.', (t) => {
  const endpoint = 'https://endpoint';
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
    }
  ];

  const actual = constructOnlineAccessUrls(movedFiles, endpoint, t.context.buckets);
  t.deepEqual(actual.sort(sortByURL), expected.sort(sortByURL));
});
