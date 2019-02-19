'use strict';

const test = require('ava');

const util = require('../util');

test('omit removes a key from object', (t) => {
  const testObj = {
    leaveme: 'a value',
    Type: 'should be stripped'
  };
  const expected = { leaveme: 'a value' };

  const actual = util.omit(testObj, 'Type');

  t.deepEqual(expected, actual);
});

test('omit returns same object if key does not exist', (t) => {
  const testObj = {
    leaveme: 'a value',
    existing: 'should not be stripped from object'
  };
  const expected = { ...testObj };

  const actual = util.omit(testObj, 'Type');

  t.deepEqual(expected, actual);
});

test('omit removes an array of keys from object', (t) => {
  const testObj = {
    a: 1, b: 2, c: 3, leaveme: 'a value'
  };

  const expected = { leaveme: 'a value' };

  const actual = util.omit(testObj, ['a', 'b', 'c']);

  t.deepEqual(expected, actual);
});

test('negate() returns a function that returns the inverse of the original function', (t) => {
  const isEven = (x) => x % 2 === 0;
  const isOdd = util.negate(isEven);

  t.false(isOdd(2));
  t.true(isOdd(3));
});

test('isNull() tests if a value is null', (t) => {
  t.true(util.isNull(null));
  t.false(util.isNull(undefined));
  t.false(util.isNull('asdf'));
});

test('isUndefined() tests if a value is undefined', (t) => {
  t.true(util.isUndefined(undefined));
  t.false(util.isUndefined(null));
  t.false(util.isUndefined('asdf'));
});

test('isNil() tests if a value is undefined', (t) => {
  t.true(util.isNil(undefined));
  t.true(util.isNil(null));
  t.false(util.isNil('asdf'));
});
