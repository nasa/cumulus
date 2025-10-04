'use strict';

const test = require('ava');
const { InvalidRegexError, UnmatchedRegexError } = require('@cumulus/errors');
const { fakeCollectionFactory } = require('../../lib/testUtils');
const { validateCollection, setEnvVarsForOperation } = require('../../lib/utils');

test.afterEach(() => {
  delete process.env.TEST_VAR;
});

test.serial('setEnvVarsForOperation should set environment variables from event', (t) => {
  const event = {
    envVars: {
      TEST_VAR: 'test value',
    },
  };

  setEnvVarsForOperation(event);

  t.is(process.env.TEST_VAR, 'test value');
});

test.serial('setEnvVarsForOperation should not overwrite existing environment variables', (t) => {
  process.env.TEST_VAR = 'existing value';
  const event = {
    envVars: {
      TEST_VAR: 'new value',
    },
  };

  setEnvVarsForOperation(event);

  t.is(process.env.TEST_VAR, 'existing value');
});

test.serial('setEnvVarsForOperation should do nothing if no envVars are provided', (t) => {
  const event = {};

  setEnvVarsForOperation(event);

  t.is(process.env.TEST_VAR, undefined);
});

test('checkRegex() throws InvalidRegexError for invalid granuleIdExtraction', (t) => {
  const inputCollection = fakeCollectionFactory({ granuleIdExtraction: '*' });

  t.throws(
    () => validateCollection(inputCollection),
    {
      instanceOf: InvalidRegexError,
      message: 'Invalid granuleIdExtraction: Invalid regular expression: /*/: Nothing to repeat',
    }
  );
});

test('checkRegex() throws UnmatchedRegexError for non-matching granuleIdExtraction', (t) => {
  const inputCollection = fakeCollectionFactory({
    granuleIdExtraction: '(1234)',
    sampleFileName: 'abcd',
  });

  t.throws(
    () => validateCollection(inputCollection),
    {
      instanceOf: UnmatchedRegexError,
      message: 'granuleIdExtraction "(1234)" cannot validate "abcd"',
    }
  );
});

test('validateCollectionCoreConfig() throws UnmatchedRegexError for granuleIdExtraction with no matching group', (t) => {
  const inputCollection = fakeCollectionFactory({
    granuleIdExtraction: '1234',
    sampleFileName: '1234',
  });

  t.throws(
    () => validateCollection(inputCollection),
    {
      instanceOf: UnmatchedRegexError,
      message: 'granuleIdExtraction regex "1234" does not return a matched group when applied to sampleFileName "1234". Ensure that your regex includes capturing groups.',
    }
  );
});

test('validateCollectionCoreConfig() throws InvalidRegexError for invalid granuleId', (t) => {
  const inputCollection = fakeCollectionFactory({ granuleId: '*' });

  t.throws(
    () => validateCollection(inputCollection),
    {
      instanceOf: InvalidRegexError,
      message: 'Invalid granuleId: Invalid regular expression: /*/: Nothing to repeat',
    }
  );
});

test('validateCollectionCoreConfig() throws UnmatchedRegexError for non-matching granuleId', (t) => {
  const inputCollection = fakeCollectionFactory({
    granuleIdExtraction: '(1234)',
    sampleFileName: '1234',
    granuleId: 'abcd',
  });

  t.throws(
    () => validateCollection(inputCollection),
    {
      instanceOf: UnmatchedRegexError,
      message: 'granuleId "abcd" cannot validate "1234"',
    }
  );
});

test('validateCollectionFilesConfig() throws InvalidRegexError for invalid file.regex', (t) => {
  const inputCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '*',
      sampleFileName: 'filename',
    }],
  });
  t.throws(
    () => validateCollection(inputCollection),
    {
      instanceOf: InvalidRegexError,
      message: 'Invalid regex: Invalid regular expression: /*/: Nothing to repeat',
    }
  );
});

test('validateCollectionFilesConfig() throws UnmatchedRegexError for non-matching file.regex', (t) => {
  const inputCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '^1234$',
      sampleFileName: 'filename',
    }],
  });
  t.throws(
    () => validateCollection(inputCollection),
    {
      instanceOf: UnmatchedRegexError,
      message: 'regex "^1234$" cannot validate "filename"',
    }
  );
});

test('validateCollectionFilesConfig() throws UnmatchedRegexError for unmatched file.checksumFor', (t) => {
  const inputCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '^.*$',
      sampleFileName: 'filename',
      checksumFor: '^1234$',
    }],
  });
  t.throws(
    () => validateCollection(inputCollection),
    {
      instanceOf: UnmatchedRegexError,
      message: 'checksumFor \'^1234$\' does not match any file regex',
    }
  );
});

test('validateCollectionFilesConfig() throws InvalidRegexError for file.checksumFor matching multiple files', (t) => {
  const inputCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '^.*$',
      sampleFileName: 'filename',
    },
    {
      bucket: 'bucket',
      regex: '^.*$',
      sampleFileName: 'filename2',
    },
    {
      bucket: 'bucket',
      regex: '^file.*$',
      sampleFileName: 'filename3',
      checksumFor: '^.*$',
    }],
  });
  t.throws(
    () => validateCollection(inputCollection),
    {
      instanceOf: InvalidRegexError,
      message: 'checksumFor \'^.*$\' matches multiple file regexes',
    }
  );
});

test('validateCollectionFilesConfig() throws InvalidRegexError for file.checksumFor matching its own file', (t) => {
  const inputCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '^.*$',
      sampleFileName: 'filename',
      checksumFor: '^.*$',
    }],
  });
  t.throws(
    () => validateCollection(inputCollection),
    {
      instanceOf: InvalidRegexError,
      message: 'checksumFor \'^.*$\' cannot be used to validate itself',
    }
  );
});
