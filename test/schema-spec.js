'use strict';
/**
 * Tests validations with the schema
 */

describe('schema', () => {
  it('is currently failing', () => {
    throw new Error('FIXME: Schema validation currently fails due to changing FS paths');
  });
});

/*
const fs = require('fs');
const schema = require('../schema');
const expect = require('expect.js');

const validCollection = JSON.parse(
  fs.readFileSync(`${__dirname}/example-data/example-collection.json`,
                  'UTF-8'));
const validEnvelope = JSON.parse(
  fs.readFileSync(`${__dirname}/example-data/example-message-envelope.json`,
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
  describe('validateEnvelope', () => {
    it('Should return true for valid data', () => {
      expect(schema.validateEnvelope(validEnvelope)).to.be(true);
      expect(schema.validateEnvelope.errors).to.be(null);
    });
    it('Should return false for invalid data', () => {
      expect(schema.validateEnvelope({ invalid: 'thing' })).to.be(false);
      it('And have errors', () => {
        expect(schema.validateEnvelope.errors).to.not.be(null);
      });
    });
  });
});
*/
