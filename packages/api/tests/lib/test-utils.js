'use strict';

const test = require('ava');

const { parseException } = require('../../lib/utils');

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
      Cause: 'blah'
    }
  );
});
