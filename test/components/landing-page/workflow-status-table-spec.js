'use strict';

const { lastCompleted, NotRunIcon } =
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

