'use strict';

const test = require('ava');
const { buildFileSourceURL } = require('../../../lib/FileUtils');

test('buildFileSourceURL() returns a correct S3 source URL', (t) => {
  const file = {
    path: 'path/to',
    name: 'file.txt'
  };

  t.is(
    buildFileSourceURL('s3://my-bucket', file),
    's3://my-bucket/path/to/file.txt'
  );
});

test('buildFileSourceURL() returns a correct source URL with a leading slash in its path', (t) => {
  const file = {
    path: '/path/to',
    name: 'file.txt'
  };

  t.is(
    buildFileSourceURL('http://my-host', file),
    'http://my-host/path/to/file.txt'
  );
});

test('buildFileSourceURL() returns a correct source URL with a non-standard port', (t) => {
  const file = {
    path: '/path/to',
    name: 'file.txt'
  };

  t.is(
    buildFileSourceURL('http://my-host:8080', file),
    'http://my-host:8080/path/to/file.txt'
  );
});

test('buildFileSourceURL() throws a TypeError if the file does not have a path property', (t) => {
  const file = {
    name: 'file.txt'
  };

  try {
    buildFileSourceURL('http://example.com', file);
    t.fail('Expected a TypeError to be thrown');
  }
  catch (err) {
    t.true(err instanceof TypeError);
    t.is(err.message, 'Cannot build a source URL for a file without a path property');
  }
});
