'use strict';

const test = require('ava');

const { generateIterableTestDirectories } = require('../utils');

test('generateIterableTestDirectories returns expected array', async (t) => {
  const expected = ['base_0', 'base_1', 'base_2'];
  const actual = generateIterableTestDirectories('base', 3);
  t.deepEqual(actual, expected);
});

test('generateIterableTestDirectories transitions to alpha directories', async (t) => {
  const expected = 'base_a';
  const actual = generateIterableTestDirectories('base', 11);
  t.is(expected, actual[9]);
});
