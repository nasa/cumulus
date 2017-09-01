'use strict';
const test = require('ava');
const log = require('@cumulus/common/log');
const pdrd = require('../pdrd');

const badFileEntryFixture = require('./fixtures/bad-file-entry-fixture');
const invalidPvlFixture = require('./fixtures/invalid-pvl-fixture');
const missingFieldsFixture = require('./fixtures/missing-fields-fixture');

test('generatePdrd() - invalid PVL gets a short PDRD', t => {
  const pdrdStr = pdrd.generatePdrd(
    invalidPvlFixture.topLevelErrors,
    invalidPvlFixture.fileGroupErrors
  );

  const pdrdType = pdrdStr.match(/MESSAGE_TYPE = (.*?);/)[1];
  t.is(pdrdType, 'SHORTPDRD');

  const errMsg = pdrdStr.split('\n')[1];
  t.is(errMsg, 'INVALID PVL STATEMENT');
});

test('generatePdrd() - missing fields gets a short PDRD', t => {
  const pdrdStr = pdrd.generatePdrd(
    missingFieldsFixture.invalidDirectory.input.topLevelErrors,
    missingFieldsFixture.invalidDirectory.input.fileGroupErrors
  );

  const pdrdType = pdrdStr.match(/MESSAGE_TYPE = (.*?);/)[1];
  t.is(pdrdType, 'SHORTPDRD');

  const errMsg = pdrdStr.split('\n')[1];
  t.is(errMsg, 'INVALID DIRECTORY');
});
