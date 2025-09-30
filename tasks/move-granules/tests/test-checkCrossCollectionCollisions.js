'use strict';

const test = require('ava');
const sinon = require('sinon');
const { InvalidArgument, ValidationError, FileNotFound } = require('@cumulus/errors');

const { _checkCrossCollectionCollisions } = require('..');

let getFileGranuleAndCollectionByBucketAndKeyStub;

test.beforeEach((t) => {
  process.env.stackName = 'fakeStack';
  // Stub out the external dependency before each test
  getFileGranuleAndCollectionByBucketAndKeyStub = sinon.stub();
  t.context.getFileGranuleAndCollectionByBucketAndKeyStub =
    getFileGranuleAndCollectionByBucketAndKeyStub;
});

test.afterEach.always(() => {
  // Restore the stub after each test
  sinon.restore();
});

test('_checkCrossCollectionCollisions does not throw an error if the file is in the expected collection', async (t) => {
  const expectedCollectionId = 'my-collection-id';
  const testGranuleId = 'granule-001';

  // Mock the external method to return the same collection ID
  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.returns(
    Promise.resolve({
      body: JSON.stringify({
        granuleId: testGranuleId,
        collectionId: expectedCollectionId,
      }),
    })
  );

  const params = {
    bucket: 'test-bucket',
    key: 'test-key',
    granuleCollectionId: expectedCollectionId,
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  // Expect the function to resolve without throwing
  await t.notThrowsAsync(() => _checkCrossCollectionCollisions(params));

  // Verify the stub was called with the correct parameters
  t.true(
    t.context.getFileGranuleAndCollectionByBucketAndKeyStub.calledOnceWith({
      bucket: 'test-bucket',
      key: 'test-key',
      prefix: process.env.stackName,
      pRetryOptions: { retries: 3 },
    })
  );
});

test('_checkCrossCollectionCollisions throws InvalidArgument error if a cross-collection collision is detected', async (t) => {
  const existingCollectionId = 'existing-collection-id';
  const newCollectionId = 'new-collection-id';
  const testGranuleId = 'granule-002';
  const testBucket = 'test-bucket';
  const testKey = 'test-key';

  // Mock the external method to return a different collection ID
  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.returns(
    Promise.resolve({
      body: JSON.stringify({
        granuleId: testGranuleId,
        collectionId: existingCollectionId,
      }),
    })
  );

  const params = {
    bucket: testBucket,
    key: testKey,
    granuleCollectionId: newCollectionId,
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  // Expect the function to throw an InvalidArgument error
  const error = await t.throwsAsync(
    () => _checkCrossCollectionCollisions(params),
    {
      instanceOf: InvalidArgument,
    }
  );

  // Verify the error message contains the expected details
  t.true(
    error.message.includes(
      `File already exists in bucket ${testBucket} with key ${testKey}`
    )
  );
  t.true(
    error.message.includes(
      `for collection ${existingCollectionId} and granuleId: ${testGranuleId}`
    )
  );
  t.true(
    error.message.includes(
      `but is being moved for collection ${newCollectionId}.`
    )
  );

  // Verify the stub was called with the correct parameters
  t.true(
    t.context.getFileGranuleAndCollectionByBucketAndKeyStub.calledOnceWith({
      bucket: testBucket,
      key: testKey,
      prefix: process.env.stackName,
      pRetryOptions: { retries: 3 },
    })
  );
});

test.serial('_checkCrossCollectionCollisions throws if collectionId is present but granuleCollectionId is null/undefined', async (t) => {
  const existingCollectionId = 'existing-collection-id';
  const testGranuleId = 'granule-003';

  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.returns(
    Promise.resolve({
      body: JSON.stringify({
        granuleId: testGranuleId,
        collectionId: existingCollectionId,
      }),
    })
  );

  const params = {
    bucket: 'test-bucket',
    key: 'test-key',
    granuleCollectionId: undefined, // Simulating a case where granuleCollectionId is not provided
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  await t.throwsAsync(() => _checkCrossCollectionCollisions(params), {
    instanceOf: ValidationError,
  });
});

test('_checkCrossCollectionCollisions throws InvalidArgument when apiResponse body has no collectionId', async (t) => {
  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.returns(
    Promise.resolve({
      body: JSON.stringify({}), // Empty body, no granuleId or collectionId
    })
  );

  const params = {
    bucket: 'test-bucket',
    key: 'test-key',
    granuleCollectionId: 'expected-collection',
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  const error = await t.throwsAsync(
    () => _checkCrossCollectionCollisions(params),
    { instanceOf: InvalidArgument }
  );

  t.true(error.message.includes('File already exists in bucket test-bucket with key test-key'));
  t.true(error.message.includes('for collection undefined'));
  t.true(t.context.getFileGranuleAndCollectionByBucketAndKeyStub.calledOnce);
});

test('_checkCrossCollectionCollisions ensures getFileGranuleAndCollectionByBucketAndKeyMethod is called with bucket and key', async (t) => {
  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.returns(
    Promise.resolve({
      body: JSON.stringify({ granuleId: 'test-granule', collectionId: 'some-id' }),
    })
  );

  const params = {
    bucket: 'another-bucket',
    key: 'another-key',
    granuleCollectionId: 'some-id',
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  await _checkCrossCollectionCollisions(params);
  t.true(t.context.getFileGranuleAndCollectionByBucketAndKeyStub.calledOnce);
  t.deepEqual(
    t.context.getFileGranuleAndCollectionByBucketAndKeyStub.firstCall.args[0],
    {
      bucket: 'another-bucket',
      key: 'another-key',
      prefix: process.env.stackName,
      pRetryOptions: { retries: 3 },
    }
  );
});

test('_checkCrossCollectionCollisions uses custom retry count when provided', async (t) => {
  const customRetryCount = 5;

  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.returns(
    Promise.resolve({
      body: JSON.stringify({ granuleId: 'test-granule', collectionId: 'test-collection' }),
    })
  );

  const params = {
    bucket: 'test-bucket',
    key: 'test-key',
    granuleCollectionId: 'test-collection',
    collectionCheckRetryCount: customRetryCount,
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  await _checkCrossCollectionCollisions(params);

  t.true(
    t.context.getFileGranuleAndCollectionByBucketAndKeyStub.calledOnceWith({
      bucket: 'test-bucket',
      key: 'test-key',
      prefix: process.env.stackName,
      pRetryOptions: { retries: customRetryCount },
    })
  );
});

test('_checkCrossCollectionCollisions throws FileNotFound when API returns 404 and crossCollectionThrowOnObjectNotFound is true', async (t) => {
  const rejectError = new Error('Not Found');
  rejectError.statusCode = 404;

  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.rejects(rejectError);

  const params = {
    bucket: 'test-bucket',
    key: 'test-key',
    granuleCollectionId: 'test-collection',
    crossCollectionThrowOnObjectNotFound: true,
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  const error = await t.throwsAsync(
    () => _checkCrossCollectionCollisions(params),
    { instanceOf: FileNotFound }
  );

  t.true(error.message.includes('File test-key in bucket test-bucket does not exist in the Cumulus database'));
});

test('_checkCrossCollectionCollisions returns early when file not found and crossCollectionThrowOnObjectNotFound is false', async (t) => {
  const rejectError = new Error('Not Found');
  rejectError.statusCode = 404;

  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.rejects(rejectError);

  const params = {
    bucket: 'test-bucket',
    key: 'test-key',
    granuleCollectionId: 'test-collection',
    crossCollectionThrowOnObjectNotFound: false,
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  await t.notThrowsAsync(() => _checkCrossCollectionCollisions(params));
});

test('_checkCrossCollectionCollisions re-throws non-404 errors', async (t) => {
  const error500 = new Error('Internal Server Error');
  error500.statusCode = 500;

  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.rejects(error500);

  const params = {
    bucket: 'test-bucket',
    key: 'test-key',
    granuleCollectionId: 'test-collection',
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  const error = await t.throwsAsync(
    () => _checkCrossCollectionCollisions(params)
  );

  t.is(error.message, 'Internal Server Error');
  t.is(error.statusCode, 500);
});

test('_checkCrossCollectionCollisions re-throws errors without statusCode property', async (t) => {
  const genericError = new Error('Generic error');

  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.rejects(genericError);

  const params = {
    bucket: 'test-bucket',
    key: 'test-key',
    granuleCollectionId: 'test-collection',
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  const error = await t.throwsAsync(
    () => _checkCrossCollectionCollisions(params)
  );

  t.is(error.message, 'Generic error');
});

test('_checkCrossCollectionCollisions uses default parameters when not provided', async (t) => {
  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.returns(
    Promise.resolve({
      body: JSON.stringify({ granuleId: 'test-granule', collectionId: 'test-collection' }),
    })
  );

  const params = {
    bucket: 'test-bucket',
    key: 'test-key',
    granuleCollectionId: 'test-collection',
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  await _checkCrossCollectionCollisions(params);

  t.true(
    t.context.getFileGranuleAndCollectionByBucketAndKeyStub.calledOnceWith({
      bucket: 'test-bucket',
      key: 'test-key',
      prefix: process.env.stackName,
      pRetryOptions: { retries: 3 }, // Default retry count
    })
  );
});

test('_checkCrossCollectionCollisions throws InvalidArgument when collectionId is null but granuleCollectionId is provided', async (t) => {
  t.context.getFileGranuleAndCollectionByBucketAndKeyStub.returns(
    Promise.resolve({
      body: JSON.stringify({ granuleId: 'test-granule', collectionId: undefined }),
    })
  );

  const params = {
    bucket: 'test-bucket',
    key: 'test-key',
    granuleCollectionId: 'test-collection',
    getFileGranuleAndCollectionByBucketAndKeyMethod:
      t.context.getFileGranuleAndCollectionByBucketAndKeyStub,
  };

  const error = await t.throwsAsync(
    () => _checkCrossCollectionCollisions(params),
    { instanceOf: InvalidArgument }
  );

  t.true(error.message.includes('File already exists in bucket test-bucket with key test-key'));
  t.true(error.message.includes('for collection undefined and granuleId: test-granule'));
  t.true(error.message.includes('but is being moved for collection test-collection'));
});
