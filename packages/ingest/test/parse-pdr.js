'use strict';

const test = require('ava');
const path = require('path');
const {
  findTestDataDirectory,
  randomString
} = require('@cumulus/common/test-utils');
const { parsePdr } = require('../parse-pdr');

test('parse-pdr properly parses a simple PDR file', async (t) => {
  const testDataDirectory = await findTestDataDirectory();
  const pdrFilename = path.join(testDataDirectory, 'pdrs', 'MOD09GQ.PDR');

  const pdrName = `${randomString()}.PDR`;
  const collection = {
    granuleIdExtraction: '^(.*)\.hdf'
  };

  const result = await parsePdr(pdrFilename, collection, pdrName);

  t.is(result.filesCount, 2);
  t.is(result.granulesCount, 1);
  t.is(result.granules.length, 1);
  t.is(result.totalSize, 17909733);

  const hdfFile = result.granules[0].files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf'); // eslint-disable-line max-len
  t.truthy(hdfFile);
  t.is(hdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(hdfFile.fileSize, 17865615);
  t.is(hdfFile.checksumType, 'CKSUM');
  t.is(hdfFile.checksumValue, 4208254019);

  const metFile = result.granules[0].files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met'); // eslint-disable-line max-len
  t.truthy(metFile);
  t.is(metFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(metFile.fileSize, 44118);
});
