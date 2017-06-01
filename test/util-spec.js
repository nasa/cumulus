'use strict';

const { parseJulian } = require('../app/scripts/util');

const chai = require('chai');
const expect = chai.expect;

describe('parseJulian', () => {
  describe('non-leap years', () => {
    it('should parse a normal day', () => {
      expect(parseJulian('2017130')).to.equal('2017-05-10');
    });
    it('should handle the first day of the year', () => {
      expect(parseJulian('20171')).to.equal('2017-01-01');
      expect(parseJulian('2017001')).to.equal('2017-01-01');
    });
    it('should handle the last day of the year', () => {
      expect(parseJulian('2017365')).to.equal('2017-12-31');
    });
  });

  describe('leap years', () => {
    it('should parse a normal day year after 2/29 as 1 day prior to non-leap year', () => {
      expect(parseJulian('2016130')).to.equal('2016-05-09');
    });
    it('should handle the first day of the year', () => {
      expect(parseJulian('20161')).to.equal('2016-01-01');
      expect(parseJulian('2016001')).to.equal('2016-01-01');
    });
    it('should handle the last day of the year', () => {
      expect(parseJulian('2016366')).to.equal('2016-12-31');
    });
  });
});
