'use strict';
/**
 * Tests validations with the schema
 */

const fs = require('fs');
const local = require('../local-helpers');

local.changeRootPath('../../../../cumulus/');

const schema = require('../schema');
const expect = require('expect.js');

const validCollection = JSON.parse(
  fs.readFileSync(`${local.fileRoot()}/docs/schemas/example-data/example-collection.json`,
                  'UTF-8'));
const validMessage = JSON.parse(
  fs.readFileSync(`${local.fileRoot()}/docs/schemas/example-data/example-message-envelope.json`,
                  'UTF-8'));

describe('schema', () => {
  describe('validateCollectionsConfiguration', () => {
    it('Should return true for valid data', () => {
      expect(schema.validateCollectionsConfiguration(validCollection)).to.be(true);
      expect(schema.validateCollectionsConfiguration.errors).to.be(null);
    });
    it('Should return false for invalid data', () => {
      expect(schema.validateCollectionsConfiguration({ invalid: 'thing' })).to.be(false);
      it('And have errors', () => {
        expect(schema.validateCollectionsConfiguration.errors).to.not.be(null);
      });
    });
  });
  describe('validateMessageEnvelope', () => {
    it('Should return true for valid data', () => {
      expect(schema.validateMessageEnvelope(validMessage)).to.be(true);
      expect(schema.validateMessageEnvelope.errors).to.be(null);
    });
    it('Should return false for invalid data', () => {
      expect(schema.validateMessageEnvelope({ invalid: 'thing' })).to.be(false);
      it('And have errors', () => {
        expect(schema.validateMessageEnvelope.errors).to.not.be(null);
      });
    });
  });
});
