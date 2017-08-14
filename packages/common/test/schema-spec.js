'use strict';
/**
 * Tests validations with the schema
 */

const validMessage = require('@cumulus/test-data/schemas/example-data/example-message-envelope.json');
const validCollection = require('@cumulus/test-data/schemas/example-data/example-collection.json');
const local = require('../local-helpers');

const schema = require('../schema');
const expect = require('expect.js');

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
