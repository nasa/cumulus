'use strict';

const test = require('ava');
const proxyquire = require('proxyquire').noPreserveCache();

test('getTeaBucketPath returns a mapped bucket path on an expected response from TEA', async (t) => {
  const { getTeaBucketPath } = proxyquire('../tea', {
    got: {
      get: async () => ({ body: '["fake-bucket-redirect/path"]' })
    }
  });

  const actual = await getTeaBucketPath();
  t.is('fake-bucket-redirect/path', actual);
});


test('getTeaBucketPath throws error if multiple paths are returned', async (t) => {
  const { getTeaBucketPath } = proxyquire('../tea', {
    got: {
      get: async () => ({ body: '["fake-bucket-redirect/path", "some-other-path"]' })
    }
  });
  await t.throwsAsync(() => getTeaBucketPath());
});

test('getTeaBucketPath returns empty string if TEA throws a 404', async (t) => {
  const { getTeaBucketPath } = proxyquire('../tea', {
    got: {
      get: async () => {
        const error = new Error('Response code 404 (Not Found)');
        error.statusCode = 404;
        error.name = 'HTTPError';
        error.statusMessage = 'Not Found';
        throw error;
      }
    }
  });
  const actual = await getTeaBucketPath();
  t.is('', actual);
});
