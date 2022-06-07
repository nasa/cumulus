'use strict';

const test = require('ava');
const { randomId } = require('@cumulus/common/test-utils');
const { isFileExtensionMatched, parseException } = require('../utils');

test('parseExecption() returns an empty object if the exception is null or undefined', (t) => {
  t.deepEqual(
    parseException(null),
    {}
  );

  t.deepEqual(
    parseException(undefined),
    {}
  );
});

test('parseException() returns the exception if it is an object', (t) => {
  t.deepEqual(
    parseException({ a: 1 }),
    { a: 1 }
  );
});

test('parseException() returns an Unknown Error object if the exception is not an object', (t) => {
  t.deepEqual(
    parseException('blah'),
    {
      Error: 'Unknown Error',
      Cause: 'blah',
    }
  );
});

test('isFileExtensionMatched() checks if the file key has the extension', (t) => {
  const granuleFile = {
    key: `${randomId('key')}.iso.xml`,
  };
  t.true(isFileExtensionMatched(granuleFile, '.iso.xml'));
  t.false(isFileExtensionMatched(granuleFile, '.cmr.json'));
});

test('isFileExtensionMatched() checks if the file name has the extension', (t) => {
  const granuleFile = {
    name: `${randomId('name')}.iso.xml`,
  };
  t.true(isFileExtensionMatched(granuleFile, '.iso.xml'));
  t.false(isFileExtensionMatched(granuleFile, '.cmr.json'));
});

test('isFileExtensionMatched() checks if the file filename has the extension', (t) => {
  const granuleFile = {
    filename: `${randomId('filename')}.iso.xml`,
  };
  t.true(isFileExtensionMatched(granuleFile, '.iso.xml'));
  t.false(isFileExtensionMatched(granuleFile, '.cmr.json'));
});
