'use strict';

const { lastCompleted, NotRunIcon, parseJulian } =
  require('../../../app/scripts/components/landing-page/workflow-status-table');
const { SuccessIcon, ErrorIcon } = require('../../../app/scripts/components/icon');

const React = require('react');
const { fromJS } = require('immutable');
const chai = require('chai');
chai.use(require('chai-immutable'));
chai.use(require('jsx-chai').default);

const expect = chai.expect;

describe('lastCompleted', () => {
  it('should return Not yet when nothing has completed', () => {
    expect(lastCompleted(null)).to.deep.equal(
      <span><NotRunIcon />not yet</span>
    );
  });
  it('should return a humanized time', () => {
    const twoHoursAgo = Date.now() - (3600 * 2 * 1000);
    it('and indicate success', () => {
      const lastExecution = fromJS({ success: true, stop_date: twoHoursAgo });
      expect(lastCompleted(lastExecution)).to.deep.equal(<span><SuccessIcon />2 hours ago</span>);
    });
    it('and indicate failure', () => {
      const lastExecution = fromJS({ success: false, stop_date: twoHoursAgo });
      expect(lastCompleted(lastExecution)).to.deep.equal(<span><ErrorIcon />2 hours ago</span>);
    });
  });
});

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
