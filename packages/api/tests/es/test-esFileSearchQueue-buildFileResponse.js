'use strict';

const fs = require('fs-extra');
const test = require('ava');
const rewire = require('rewire');

const esFileQueue = rewire('../../es/esFileQueue');

const buildFilesResponse = esFileQueue.__get__('buildFilesResponse');

const granuleFileList = JSON.parse(
  fs.readFileSync(`${__dirname}/fixtures/granulesFileList.json`, 'utf8')
);

test('buildFileResponse transforms a granules file list into correct objects.', (t) => {
  const actual = buildFilesResponse(granuleFileList, 'stackName-protected');

  const expected = [
    {
      granuleId: 'gran.nToe7O.001',
      bucket: 'stackName-protected',
      fileName: 'gran.nToe7O.001.cmr.json',
      key: 'gran___001/stackName/gran.nToe7O.001.cmr.json'
    },
    {
      granuleId: 'gran.nToe7O.001',
      bucket: 'stackName-protected',
      fileName: 'gran.nToe7O.001.hdf',
      key:
        'stackName-test-data/files/gran___001/2016/stackName/gran.nToe7O.001.hdf'
    },
    {
      granuleId: 'gran.A7444061.d7sYKL.001',
      bucket: 'stackName-protected',
      fileName: 'gran.A7444061.d7sYKL.001.cmr.json',
      key: 'gran___001/stackName/gran.A7444061.d7sYKL.001.cmr.json'
    }
  ];

  t.deepEqual(expected, actual);
});

test('buildFilesResponse returns empty array if no files match', (t) => {
  const actual = buildFilesResponse(granuleFileList, 'bucket-that-wont-match');
  const expected = [];
  t.deepEqual(expected, actual);
});
