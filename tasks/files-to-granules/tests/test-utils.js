'use strict';

const test = require('ava');
const { getGranuleId } = require('../utils');

test('getGranuleId is successful', (t) => {
  const uri = 'test.txt';
  const regex = '(.*).txt';
  t.is(getGranuleId(uri, regex), 'test');
});

test('getGranuleId fails', (t) => {
  const uri = 'test.txt';
  const regex = '(.*).TXT';

  t.throws(
    () => getGranuleId(uri, regex),
    {
      instanceOf: Error,
      message: `Could not determine granule id of ${uri} using ${regex}`
    }
  );
});
