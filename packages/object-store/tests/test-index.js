const test = require('ava');
const { S3ObjectStore } = require('@cumulus/aws-client');
const { defaultObjectStore, objectStoreForProtocol } = require('../dist');

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
