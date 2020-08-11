'use strict';

const test = require('ava');
const rewire = require('rewire');

const fileUtils = rewire('../../../lib/FileUtils');
const parseSource = fileUtils.__get__('parseSource');

test('leaves file unchanged if it has no source', (t) => {
  const file = {
    key: 'key',
    bucket: 'bucket',
    path: 'path',
    anythingelse: 'anything else',
  };

  const expected = { ...file };

  const actual = parseSource(file);

  t.deepEqual(expected, actual);
});

test('leaves file unchanged if key is not null', (t) => {
  const file = {
    key: 'notnull',
    bucket: null,
    path: 'path',
    anythingelse: 'anything else',
  };

  const expected = { ...file };

  const actual = parseSource(file);

  t.deepEqual(expected, actual);
});

test('leaves file unchanged if bucket is not null', (t) => {
  const file = {
    key: null,
    bucket: 'notnull',
    path: 'path',
    anythingelse: 'anything else',
  };

  const expected = { ...file };

  const actual = parseSource(file);

  t.deepEqual(expected, actual);
});

test('leaves file unchanged if key and bucket are undefined', (t) => {
  const file = {
    path: 'path',
    anythingelse: 'anything else',
  };

  const expected = { ...file };

  const actual = parseSource(file);

  t.deepEqual(expected, actual);
});

test('updates bucket and key if source is a s3 url', (t) => {
  const file = {
    bucket: null,
    key: null,
    source: 's3://bucketname/some/key/to/file',
    path: 'path',
    anythingelse: 'anything else',
  };

  const expected = { ...file };
  expected.key = 'some/key/to/file';
  expected.bucket = 'bucketname';

  const actual = parseSource(file);

  t.deepEqual(expected, actual);
});

test('leaves file unchanged if source is an http url', (t) => {
  const file = {
    bucket: null,
    key: null,
    source: 'https://bucketname/some/key/to/file',
    path: 'path',
    anythingelse: 'anything else',
  };

  const expected = { ...file };

  const actual = parseSource(file);

  t.deepEqual(expected, actual);
});
