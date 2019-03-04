'use strict';

const test = require('ava');
const { getFileName } = require('../../../lib/FileUtils');

test('getFileName() returns the value of the fileName property', (t) => {
  const file = { fileName: 'my-file-name.txt' };

  t.is(
    getFileName(file),
    'my-file-name.txt'
  );
});

test('getFileName() returns the value of the name property', (t) => {
  const file = { name: 'my-file-name.txt' };

  t.is(
    getFileName(file),
    'my-file-name.txt'
  );
});

test('getFileName() prefers fileName over name', (t) => {
  const file = {
    fileName: 'my-fileName.txt',
    name: 'my-name.txt'
  };

  t.is(
    getFileName(file),
    'my-fileName.txt'
  );
});

test('getFileName() returns null if no file name could be found', (t) => {
  const file = {};

  t.is(
    getFileName(file),
    null
  );
});
