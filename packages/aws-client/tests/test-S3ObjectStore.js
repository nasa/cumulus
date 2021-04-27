const test = require('ava');
const sinon = require('sinon');
const { defaultObjectStore, objectStoreForProtocol, S3ObjectStore } = require('../S3ObjectStore');
const S3 = require('../S3');

test('objectStoreForProtocol returns null when no protocol is supplied', (t) => {
  t.is(objectStoreForProtocol(), undefined);
});

test('objectStoreForProtocol returns null when an unrecognized protocol is supplied', (t) => {
  t.is(objectStoreForProtocol('azure'), undefined);
});

test('objectStoreForProtocol returns an S3ObjectStore when "s3" is supplied as the protocol', (t) => {
  t.true(objectStoreForProtocol('s3') instanceof S3ObjectStore);
});

test('objectStoreForProtocol ignores trailing colons on the protocol', (t) => {
  t.true(objectStoreForProtocol('s3:') instanceof S3ObjectStore);
});

test('defaultObjectStore returns an S3 object store', (t) => {
  t.true(defaultObjectStore() instanceof S3ObjectStore);
});

test.serial('S3ObjectStore.signGetObject throws NotFound from S3.headObject when object does not exist', async (t) => {
  const store = new S3ObjectStore();
  const headObjectResponse = { Metadata: { foo: 'bar' }, ContentType: 'image/png' };
  const headObjectStub = sinon.stub(S3, 'headObject').returns({ promise: () => headObjectResponse });
  await store.signGetObject('s3://example-bucket/example/path.txt', { 'A-userid': 'joe' });
  t.true(headObjectStub.calledOnce);
  t.teardown(() => {
    headObjectStub.restore();
  });
});

test.serial('S3ObjectStore.signGetObject calls s3.headObject to make sure the object exists', async (t) => {
  const store = new S3ObjectStore();
  const headObjectResponse = { Metadata: { foo: 'bar' }, ContentType: 'image/png' };
  const headObjectStub = sinon.stub(S3, 'headObject').returns({ promise: () => headObjectResponse });
  await store.signGetObject('s3://example-bucket/example/path.txt', { 'A-userid': 'joe' });
  t.true(headObjectStub.calledOnce);
  t.teardown(() => {
    headObjectStub.restore();
  });
});

test.serial('S3ObjectStore.signGetObject calls s3.getObject in order to call presign', async (t) => {
  const store = new S3ObjectStore();
  const headObjectResponse = { Metadata: { foo: 'bar' }, ContentType: 'image/png' };
  const headObjectStub = sinon.stub(S3, 'headObject').returns({ promise: () => headObjectResponse });
  const getObjectStub = sinon.stub(store.s3, 'getObject').returns({ presign: () => 'http://example.com/signed' });
  await store.signGetObject('s3://example-bucket/example/path.txt', { 'A-userid': 'joe' });
  t.true(getObjectStub.calledOnce);
  t.teardown(() => {
    headObjectStub.restore();
    getObjectStub.restore();
  });
});

test.serial('S3ObjectStore.signGetObject returns result of calling presign', async (t) => {
  const store = new S3ObjectStore();
  const headObjectResponse = { Metadata: { foo: 'bar' }, ContentType: 'image/png' };
  const headObjectStub = sinon.stub(S3, 'headObject').returns({ promise: () => headObjectResponse });
  const getObjectStub = sinon.stub(store.s3, 'getObject').returns({ presign: () => 'http://example.com/signed' });
  const result = await store.signGetObject('s3://example-bucket/example/path.txt', { 'A-userid': 'joe' });
  t.is(result, 'http://example.com/signed');
  t.teardown(() => {
    headObjectStub.restore();
    getObjectStub.restore();
  });
});
