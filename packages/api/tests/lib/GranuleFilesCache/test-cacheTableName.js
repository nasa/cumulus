'use strict';

const test = require('ava');
const { cacheTableName } = require('../../../lib/GranuleFilesCache');

test.serial('cacheTableName() returns the name of the granule files cache table', (t) => {
  process.env.FilesTable = 'asdf';
  t.is(cacheTableName(), 'asdf');
});

test.serial('cacheTableName() throws an exception if the FilesTable environment variable is not set', (t) => {
  delete process.env.FilesTable;
  t.throws(cacheTableName);
});

test.serial('cacheTableName() throws an exception if the FilesTable environment variable is an empty string', (t) => {
  process.env.FilesTable = '';
  t.throws(cacheTableName);
});
