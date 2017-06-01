'use strict';

const util = require('../app/scripts/util');

const chai = require('chai');
const expect = chai.expect;

describe('parseJulian', () => {
  describe('non-leap years', () => {
    it('should parse a normal day', () => {
      expect(util.parseJulian('2017130')).to.equal('2017-05-10');
    });
    it('should handle the first day of the year', () => {
      expect(util.parseJulian('20171')).to.equal('2017-01-01');
      expect(util.parseJulian('2017001')).to.equal('2017-01-01');
    });
    it('should handle the last day of the year', () => {
      expect(util.parseJulian('2017365')).to.equal('2017-12-31');
    });
  });

  describe('leap years', () => {
    it('should parse a normal day year after 2/29 as 1 day prior to non-leap year', () => {
      expect(util.parseJulian('2016130')).to.equal('2016-05-09');
    });
    it('should handle the first day of the year', () => {
      expect(util.parseJulian('20161')).to.equal('2016-01-01');
      expect(util.parseJulian('2016001')).to.equal('2016-01-01');
    });
    it('should handle the last day of the year', () => {
      expect(util.parseJulian('2016366')).to.equal('2016-12-31');
    });
  });
});


describe('humanTimeSince', () => {
  it('should handle very recent times', () => {
    expect(util.humanTimeSince(Date.now())).to.equal('just now');
    expect(util.humanTimeSince(Date.now() - 5000)).to.equal('just now');
  });
  it('should handle a minute ago', () => {
    expect(util.humanTimeSince(Date.now() - 50000)).to.equal('a minute ago');
    expect(util.humanTimeSince(Date.now() - 60000)).to.equal('a minute ago');
    expect(util.humanTimeSince(Date.now() - 61000)).to.equal('a minute ago');
  });
  it('should handle a long time ago', () => {
    const fiveYears = 5 * 365 * 24 * 3600 * 1000;
    expect(util.humanTimeSince(Date.now() - fiveYears)).to.equal('5 years ago');
  });
});

describe('humanDuration', () => {
  it('should handle a duration smaller than a second', () => {
    expect(util.humanDuration(500)).to.equal('0.5 seconds');
  });
  it('should not return fractional seconds when larger than a second', () => {
    expect(util.humanDuration(2200)).to.equal('2 seconds');
    expect(util.humanDuration(2500)).to.equal('3 seconds');
  });
  it('should handle an exact amount of seconds', () => {
    expect(util.humanDuration(53000)).to.equal('53 seconds');
  });
  it('should handle large amounts of time', () => {
    const fourHours = 4 * 3600 * 1000;
    const threeDays = 3 * 24 * 3600 * 1000;
    const fiveYears = 5 * 365 * 24 * 3600 * 1000;
    expect(util.humanDuration(fourHours)).to.equal('4 hours');
    expect(util.humanDuration(threeDays)).to.equal('3 days');
    expect(util.humanDuration(fiveYears)).to.equal('5 years');
  });
});

