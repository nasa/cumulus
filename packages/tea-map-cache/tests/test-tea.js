'use strict';

const test = require('ava');
const proxyquire = require('proxyquire').noPreserveCache();

test('getTeaBucketPath returns a mapped bucket path on an expected response from TEA', async (t) => {
  const { getTeaBucketPath } = proxyquire('../dist/tea', {
    got: {
      get: async () => ({ body: '["fake-bucket-redirect/path"]' })
    }
  });

  const actual = await getTeaBucketPath({
    bucket: undefined,
    teaEndPoint: undefined
  });
  t.is('fake-bucket-redirect/path', actual);
});

test('getTeaBucketPath throws error if multiple paths are returned', async (t) => {
  const { getTeaBucketPath } = proxyquire('../dist/tea', {
    got: {
      get: async () => ({ body: '["fake-bucket-redirect/path", "some-other-path"]' })
    }
  });
  await t.throwsAsync(() => getTeaBucketPath({
    bucket: undefined,
    teaEndPoint: undefined
  }));
});

test('getTeaBucketPath returns empty string if TEA throws a 404', async (t) => {
  const { getTeaBucketPath } = proxyquire('../dist/tea', {
    got: {
      get: async () => {
        const error = new Error('Response code 404 (Not Found)');
        error.statusCode = 404;
        error.name = 'HTTPError';
        error.response = {
          body: 'No route defined for test-bucket'
        };
        throw error;
      }
    }
  });
  const actual = await getTeaBucketPath({ bucket: 'test-bucket' });
  t.is('', actual);
});

test('getTeaBucketPath throws an error empty string if non-bucket-search 404 is thrown', async (t) => {
  const { getTeaBucketPath } = proxyquire('../dist/tea', {
    got: {
      get: async () => {
        const error = new Error('Response code 404 (Not Found)');
        error.statusCode = 404;
        error.name = 'HTTPError';
        error.response = {
          body: 'Some other error page from API gateway/etc'
        };
        throw error;
      }
    }
  });
  await t.throwsAsync(getTeaBucketPath({ bucket: 'some bucket', retries: 0 }));
});
