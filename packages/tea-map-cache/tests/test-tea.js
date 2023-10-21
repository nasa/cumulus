'use strict';

const test = require('ava');
const proxyquire = require('proxyquire').noPreserveCache();

test('getTeaBucketPath returns a mapped bucket path on an expected response from TEA', async (t) => {
  const { getTeaBucketPath } = proxyquire('../dist/src/tea', {
    got: {
      default: {
        get: (_param) => Promise.resolve({ body: '["fake-bucket-redirect/path"]' }),
      },
    },
  });

  const actual = await getTeaBucketPath({
    bucket: 'notUsedTestValue',
    teaEndPoint: 'notUsedTestValue',
  });
  t.is('fake-bucket-redirect/path', actual);
});

test('getTeaBucketPath throws error if multiple paths are returned', async (t) => {
  const { getTeaBucketPath } = proxyquire('../dist/src/tea', {
    got: {
      default: {
        get: (_param) => Promise.resolve({ body: '["fake-bucket-redirect/path", "some-other-path"]' }),
      },
    },
  });
  await t.throwsAsync(() => getTeaBucketPath({
    bucket: 'notUsedTestValue',
    teaEndPoint: 'notUsedTestValue',
  }));
});

test('getTeaBucketPath returns empty string if TEA throws a 404', async (t) => {
  const { getTeaBucketPath } = proxyquire('../dist/src/tea', {
    got: {
      default: {
        get: () => {
          const error = new Error('Response code 404 (Not Found)');
          error.statusCode = 404;
          error.name = 'HTTPError';
          error.response = {
            body: 'No route defined for test-bucket',
          };
          return Promise.reject(error);
        },
      },
    },
  });
  const actual = await getTeaBucketPath({ bucket: 'test-bucket' });
  t.is('', actual);
});

test('getTeaBucketPath throws an error empty string if non-bucket-search 404 is thrown', async (t) => {
  const { getTeaBucketPath } = proxyquire('../dist/src/tea', {
    got: {
      default: {
        get: () => {
          const error = new Error('Response code 404 (Not Found)');
          error.statusCode = 404;
          error.name = 'HTTPError';
          error.response = {
            body: 'Some other error page from API gateway/etc',
          };
          return Promise.reject(error);
        },
      },
    },
  });
  await t.throwsAsync(getTeaBucketPath({ bucket: 'some bucket', retries: 0 }));
});
