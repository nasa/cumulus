'use strict';

const test = require('ava');
const pdrHelpers = require('../../lib/pdrHelpers');

// eslint-disable-next-line max-len
const regex = /MESSAGE_TYPE = "SHORTPAN";\nDISPOSITION = "SUCCESSFUL";\nTIME_STAMP = \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z;\n/;
// eslint-disable-next-line max-len
const emptyRegex = /MESSAGE_TYPE = "SHORTPAN";\nDISPOSITION = "";\nTIME_STAMP = \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z;\n/;

test('generateShortPAN with a disposition', (t) => {
  const disposition = 'SUCCESSFUL';
  const pan = pdrHelpers.generateShortPAN(disposition);
  t.regex(pan, regex);
});

test('generateShortPAN with an empty disposition', (t) => {
  const disposition = '';
  const pan = pdrHelpers.generateShortPAN(disposition);
  t.regex(pan, emptyRegex);
});
