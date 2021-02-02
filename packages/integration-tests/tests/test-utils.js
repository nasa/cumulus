'use strict';

const test = require('ava');

const { generateIterableTestDirectories } = require('../utils');

test('generateIterableTestDirectories returns expected array', (t) => {
  const expected = ['base_0', 'base_1', 'base_2'];
  const actual = generateIterableTestDirectories('base', 3);
  t.deepEqual(actual, expected);
});

test('generateIterableTestDirectories transitions to alpha directories', (t) => {
  const expected = 'base_a';
  const actual = generateIterableTestDirectories('base', 11);
  t.is(expected, actual[9]);
});

test('generateIterableTestDirectories throws if 36 count is specified', (t) => {
  t.throws(() => generateIterableTestDirectories('base', 36));
});
