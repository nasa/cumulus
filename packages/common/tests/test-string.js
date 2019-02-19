'use strict';

const test = require('ava');
const stringUtils = require('../string');

test('toLower() converts a string to lower case', (t) => {
  t.is(stringUtils.toLower('asDF'), 'asdf');
});

test('toUpper() converts a string to upper case', (t) => {
  t.is(stringUtils.toUpper('asDF'), 'ASDF');
});

test('match() returns ??? if a match is found', (t) => {
  t.is(stringUtils.match(/A/, 'AAA')[0], 'A');
});

test('match() returns null if a match is not found', (t) => {
  t.is(stringUtils.match(/A/, 'ZZZ'), null);
});

test('matches() returns true if a match is found', (t) => {
  t.is(stringUtils.matches(/A/, 'AAA'), true);
});

test('matches() returns false if a match is not found', (t) => {
  t.is(stringUtils.matches(/A/, 'ZZZ'), false);
});


test('isValidHostname() properly validates hostnames', (t) => {
  t.true(stringUtils.isValidHostname('asdf'));
  t.true(stringUtils.isValidHostname('example.com'));
  t.true(stringUtils.isValidHostname('a1.sauce'));
  t.true(stringUtils.isValidHostname('allow-dashes.com'));

  t.false(stringUtils.isValidHostname(''));
  t.false(stringUtils.isValidHostname('.com'));
  t.false(stringUtils.isValidHostname('-minus.com'));
  t.false(stringUtils.isValidHostname('no-$pecial-characters.com'));
  t.false(stringUtils.isValidHostname('http://with-schema.com'));
  t.false(stringUtils.isValidHostname('no spaces'));
});
