'use strict';

const test = require('ava');
const { normalizeProviderPath } = require('../util');

test('normalizeProviderPath removes only leading slashes', (t) => {
  const testString = '/////fake/path/';
  const conformed = normalizeProviderPath(testString);
  t.is(conformed, 'fake/path/');
});

test('normalizeProviderPath does not act on paths without leading slashes', (t) => {
  const testString = 'fake/path/';
  const conformed = normalizeProviderPath(testString);
  t.is(conformed, 'fake/path/');
});

test('normalizeProviderPath returns empty string by default', (t) => {
  t.is(normalizeProviderPath(null), '');
});
