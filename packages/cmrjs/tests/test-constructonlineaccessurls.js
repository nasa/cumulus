const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');

const cmrUtils = rewire('../cmr-utils');

const constructOnlineAccessUrls = cmrUtils.__get__('constructOnlineAccessUrls');

test.beforeEach((t) => {
  t.context.bucketConfig = {
    private: { name: randomId('private'), type: 'private' },
    protected: { name: randomId('protected'), type: 'protected' },
    public: { name: randomId('public'), type: 'public' }
  };
  const fake = sinon.fake.returns(t.context.bucketConfig);
  t.context.restore = cmrUtils.__set__('bucketConfig', fake);
});

test.afterEach((t) => {
  t.context.restore();
});

test('returns correct url for protected data', async (t) => {
  const endpoint = 'https://endpoint';
  const testFiles = [
    {
      filepath: 'some/path/protected-file.hdf',
      bucket: t.context.bucketConfig.protected.name
    }
  ];
  const expected = [
    {
      URL: `${endpoint}/${t.context.bucketConfig.protected.name}/some/path/protected-file.hdf`,
      URLDescription: 'File to download'
    }
  ];

  const actual = await constructOnlineAccessUrls(testFiles, endpoint);

  t.deepEqual(actual, expected);
});

test('Returns correct url for public data.', async (t) => {
  const endpoint = 'https://endpoint';
  const testFiles = [
    {
      filepath: 'some/path/browse_image.jpg',
      bucket: t.context.bucketConfig.public.name
    }
  ];
  const expected = [
    {
      URL: `https://${t.context.bucketConfig.public.name}.s3.amazonaws.com/some/path/browse_image.jpg`,
      URLDescription: 'File to download'
    }
  ];

  const actual = await constructOnlineAccessUrls(testFiles, endpoint);

  t.deepEqual(actual, expected);
});


test('Returns nothing for private data.', async (t) => {
  const endpoint = 'https://endpoint';
  const testFiles = [
    {
      filepath: 'some/path/top/secretfile',
      bucket: t.context.bucketConfig.private.name
    }
  ];
  const expected = [];

  const actual = await constructOnlineAccessUrls(testFiles, endpoint);

  t.deepEqual(actual, expected);
});

test('Works for a list of files.', async (t) => {
  const endpoint = 'https://endpoint';
  const testFiles = [
    {
      filepath: 'hidden/secretfile.gpg',
      bucket: t.context.bucketConfig.private.name
    },
    {
      filepath: 'path/publicfile.jpg',
      bucket: t.context.bucketConfig.public.name
    },
    {
      filepath: 'another/path/protected.hdf',
      bucket: t.context.bucketConfig.protected.name
    }
  ];

  const expected = [
    {
      URL: `https://${t.context.bucketConfig.public.name}.s3.amazonaws.com/path/publicfile.jpg`,
      URLDescription: 'File to download'
    },
    {
      URL: `${endpoint}/${t.context.bucketConfig.protected.name}/another/path/protected.hdf`,
      URLDescription: 'File to download'
    }
  ];

  const actual = await constructOnlineAccessUrls(testFiles, endpoint);

  t.deepEqual(actual, expected);
});
