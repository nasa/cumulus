'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');

let headObjectCallCount = 0;

const fakeS3 = () => ({
  headObject: () => {
    headObjectCallCount += 1;

    return {
      promise: () => {
        if (headObjectCallCount === 1) {
          const err = new Error('NotFound');
          err.name = 'NotFound';
          return Promise.reject(err);
        }

        return Promise.resolve({});
      },
    };
  },
});

const S3 = proxyquire(
  '../../S3',
  {
    './services': {
      s3: fakeS3,
    },
  }
);

test('waitForObjectToExist() retries if the object does not exist', async (t) => {
  await t.notThrowsAsync(
    S3.waitForObjectToExist({
      bucket: 'my-bucket',
      key: 'my-key',
      interval: 1,
    })
  );
});
