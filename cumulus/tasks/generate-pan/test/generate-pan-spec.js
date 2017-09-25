'use strict';
const pan = require('../pan');
const test = require('ava');
const allSuccessFixture = require('./fixtures/all-success-fixture');
const missingFileFixture = require('./fixtures/missing-file-fixture');

const timeStamp = (dateTime) => dateTime.toISOString().replace(/\.\d\d\dZ/, 'Z');

const shortPan = (dateTime) =>
`MESSAGE_TYPE = SHORTPAN;
DISPOSITION = "SUCCESSFUL";
TIME_STAMP = ${timeStamp(dateTime)};`;

test('generates a short PAN if all files succeed', t => {
  const input = allSuccessFixture.input;
  const now = new Date();
  const timeStampStr = timeStamp(now);
  const result = pan.generatePan(input, timeStampStr);
  t.is(result, shortPan(now));
});

test('generates a long pan with an entry for the number of files (NO_OF_FILES)', t => {
  const input = missingFileFixture.input;
  const now = new Date();
  const timeStampStr = timeStamp(now);
  const result = pan.generatePan(input, timeStampStr);
  const numFilesEntry = result.match(/NO_OF_FILES = (\d+);/)[1];
  t.is(parseInt(numFilesEntry, 10), input.length);
});

test('generates a disposition message for each file in a long PAN', t => {
  const input = missingFileFixture.input;
  const now = new Date();
  const timeStampStr = timeStamp(now);
  const result = pan.generatePan(input, timeStampStr);
  const dispositions = result.match(/DISPOSITION.*;/g);
  t.is(dispositions.length, 2);
});

test('generates a timestamp for each file entry', t => {
  const input = missingFileFixture.input;
  const now = new Date();
  const timeStampStr = timeStamp(now);
  const timeStampEntry = `TIME_STAMP = ${timeStampStr}`;
  const timeStampRegex = new RegExp(timeStampEntry, 'g');
  const result = pan.generatePan(input, timeStampStr);
  const timeStampCount = result.match(timeStampRegex).length;
  t.is(timeStampCount, input.length);
});

test('generates an error message for each missing file', t => {
  const input = missingFileFixture.input;
  const now = new Date();
  const timeStampStr = timeStamp(now);
  const result = pan.generatePan(input, timeStampStr);
  const dispositions = result.match(/DISPOSITION.*;/g);
  t.is(dispositions[0], 'DISPOSITION = "NETWORK FAILURE";');
});

