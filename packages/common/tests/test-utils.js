'use strict';

const test = require('ava');

const { omit } = require('../util');

test('omit removes a key from object', (t) => {
  const testObj = {
    leaveme: 'a value',
    Type: 'should be stripped'
  };
  const expected = { leaveme: 'a value' };

  const actual = omit(testObj, 'Type');

  t.deepEqual(expected, actual);
});

test('omit returns same object if key does not exist', (t) => {
  const testObj = {
    leaveme: 'a value',
    existing: 'should not be stripped from object'
  };
  const expected = { ...testObj };

  const actual = omit(testObj, 'Type');

  t.deepEqual(expected, actual);
});

test('omit removes an array of keys from object', (t) => {
  const testObj = {
    a: 1, b: 2, c: 3, leaveme: 'a value'
  };

  const expected = { leaveme: 'a value' };

  const actual = omit(testObj, ['a', 'b', 'c']);

  t.deepEqual(expected, actual);
});
