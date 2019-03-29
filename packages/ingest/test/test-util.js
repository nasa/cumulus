'use strict';

const test = require('ava');
const { conformProviderPath } = require('../util');

test('conformProviderPath removes only leading slashes', (t) => {
  const testString = '/////fake/path/';
  const conformed = conformProviderPath(testString);
  t.is(conformed, 'fake/path/');
});

test('conformProviderPath does not act on paths without leading slashes', (t) => {
  const testString = 'fake/path/';
  const conformed = conformProviderPath(testString);
  t.is(conformed, 'fake/path/');
});

test('conformProviderPath returns empty string by default', (t) => {
  let notString;
  const conformed = conformProviderPath(notString);
  t.is(conformed, '');
});
