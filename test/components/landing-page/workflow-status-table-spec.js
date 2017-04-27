'use strict';

const { lastCompleted, successRatio, runningStatus,
  SuccessIcon, FailedIcon, NotRunIcon } =
  require('../../../app/scripts/components/landing-page/workflow-status-table');

const React = require('react');
const { withExamples } = require('../../test-helper');
const { fromJS } = require('immutable');
const chai = require('chai');
chai.use(require('chai-immutable'));
chai.use(require('jsx-chai').default);

const expect = chai.expect;

describe('lastCompleted', () => {
  it('should return Not yet when nothing has completed', () => {
    const workflow = fromJS({ executions: [{ status: 'RUNNING' }] });
    expect(lastCompleted(workflow)).to.deep.equal(
      <span><NotRunIcon />not yet</span>
    );
  });
  it('should return a humanized time', () => {
    const twoHoursAgo = Date.now() - (3600 * 2 * 1000);
    it('and indicate success', () => {
      const workflow = fromJS(
        { executions:
        [{ status: 'RUNNING' },
         { status: 'SUCCEEDED', stop_date: twoHoursAgo }] });
      expect(lastCompleted(workflow)).to.deep.equal(<span><SuccessIcon />2 hours ago</span>);
    });
    it('and indicate failure', () => {
      const workflow = fromJS(
        { executions:
        [{ status: 'RUNNING' },
         { status: 'ABORTED', stop_date: twoHoursAgo }] });
      expect(lastCompleted(workflow)).to.deep.equal(<span><FailedIcon />2 hours ago</span>);
    });
  });
});

/**
 * A helper function that creates a workflow with executions with the given statuses.
 */
const workflowWithStatus = statuses =>
  fromJS({ executions: statuses.map(s => ({ status: s })) });

describe('successRatio', () => {
  it('should return the number successful out of not', () => {
    withExamples((args, expected) => {
      const workflow = workflowWithStatus(args);
      expect(successRatio(workflow)).to.equal(expected);
    }, ['SUCCEEDED', 'SUCCEEDED', 'ABORTED'], '2/3 Successful',
       ['ABORTED', 'ABORTED', 'ABORTED'], '0/3 Successful',
       ['SUCCEEDED', 'RUNNING', 'ABORTED'], '1/2 Successful',
       ['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED'], '3/3 Successful');
  });
});

describe('runningStatus', () => {
  it('should return the number of running executions', () => {
    withExamples((args, expected) => {
      const workflow = workflowWithStatus(args);
      expect(runningStatus(workflow)).to.equal(expected);
    }, ['SUCCEEDED', 'SUCCEEDED', 'ABORTED'], '0 Running',
    ['ABORTED', 'RUNNING', 'ABORTED'], '1 Running',
    ['RUNNING', 'RUNNING', 'RUNNING'], '3 Running');
  });
});

