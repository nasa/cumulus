'use strict';

const test = require('ava');
const { getChecksum } = require('../../../lib/FileUtils');

test('getChecksum() returns the value of the checksum property', (t) => {
  const file = { checksum: 'asdf' };

  t.is(
    getChecksum(file),
    'asdf'
  );
});

test('getChecksum() returns the value of the checksumValue property', (t) => {
  const file = { checksumValue: 'asdf' };

  t.is(
    getChecksum(file),
    'asdf'
  );
});

test('getChecksum() prefers checksum over checksumValue', (t) => {
  const file = {
    checksum: 'my-checksum',
    checksumValue: 'my-checksumValue'
  };

  t.is(
    getChecksum(file),
    'my-checksum'
  );
});

test('getChecksum() returns null if no checksum could be found', (t) => {
  const file = {};

  t.is(
    getChecksum(file),
    null
  );
});
