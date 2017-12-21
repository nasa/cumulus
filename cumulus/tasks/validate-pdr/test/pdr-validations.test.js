'use strict';

const test = require('ava');
const pdr = require('../pdr-validations');
const successFixture = require('./fixtures/success-fixture');
const missingFieldsFixture = require('./fixtures/missing-fields-fixture');
const invalidPvlFixture = require('./fixtures/invalid-pvl-fixture');
const fileErrorsFixture = require('./fixtures/file-errors-fixture');

/**
 * Macro to simplify tests by reusing common elements
 * @param {Test} t AVA Test
 * @param {Object} fixture Object containing the input and expected output
 */
const testMacro = (t, fixture) => {
  const [topLevelErrors, fileGroupErrors] = pdr.validatePdr(fixture.input);
  t.deepEqual(topLevelErrors, fixture.errors.topLevelErrors);
  t.deepEqual(fileGroupErrors, fixture.errors.fileGroupErrors);
};

// Good PDR gets no errors
test('validatePdr() - success', t => {
  testMacro(t, successFixture);
});

// Bad PVL in PDR
test('validatePdr() - invalid PVL', t => {
  testMacro(t, invalidPvlFixture);
});

// High level missing field
test('validatePdr() - top level missing field', t => {
  testMacro(t, missingFieldsFixture);
});

// File group and file spec errors
test('validatePdr() - file group / file spec errors', t => {
  testMacro(t, fileErrorsFixture);
});
