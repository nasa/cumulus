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

test('generatePdrd() - missing TOTAL_FILE_COUNT gets a short PDRD', t => {
  const pdrdStr = pdrd.generatePdrd(
    missingFieldsFixture.invalidFileCount.input.topLevelErrors,
    missingFieldsFixture.invalidFileCount.input.fileGroupErrors
  );

  const pdrdType = pdrdStr.match(/MESSAGE_TYPE = (.*?);/)[1];
  t.is(pdrdType, 'SHORTPDRD');

  const errMsg = pdrdStr.split('\n')[1];
  t.is(errMsg, 'INVALID FILE COUNT');
});

/**
 * Runs a test against the given fixture
 * @param {Test} t AVA Test object
 * @param {Object} fixture An object containing test input and expected output
 */
const testMacro = (t, fixture) => {
  const pdrdStr = pdrd.generatePdrd(
    fixture.input.topLevelErrors,
    fixture.input.fileGroupErrors
  );

  const pdrdType = pdrdStr.match(/MESSAGE_TYPE = (.*?);/)[1];
  t.is(pdrdType, 'LONGPDRD');

  const [_, fileCountLine, errMsg] = pdrdStr.split('\n');
  t.regex(fileCountLine, /NO_FILE_GRPS = \d+/);
  t.is(errMsg, fixture.error);
};

test('generatePdrd() - missing file fields gets a long PDRD', t => {
  badFileEntryFixture.fixtures.forEach(fixture => testMacro(t, fixture));
});

