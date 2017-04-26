'use strict';

const { lastCompleted, successRatio, runningStatus } =
  require('../../../app/scripts/components/landing-page/workflow-status-table');

const React = require('react');
const { fromJS } = require('immutable');
const chai = require('chai');
chai.use(require('chai-immutable'));
chai.use(require('jsx-chai').default);

const expect = chai.expect;

describe('lastCompleted', () => {
  it('should return Not yet when nothing has completed', () => {
    const workflow = fromJS({ executions: [{ status: 'RUNNING' }] });
    expect(lastCompleted(workflow)).to.equal('Not yet');
  });
  it('should return a humanized time', () => {
    const twoHoursAgo = Date.now() - (3600 * 2 * 1000);
    const workflow = fromJS({ executions:
    [{ status: 'RUNNING' },
     { status: 'SUCCEEDED', start_date: twoHoursAgo }] });
    // expect(<div />).to.deep.equal(<div />);
    expect(lastCompleted(workflow)).to.deep.equal(<p>2 hours ago</p>);
  });
});

/**
 * A helper function that creates a workflow with executions with the given statuses.
 */
const workflowWithStatus = statuses =>
  fromJS({ executions: statuses.map(s => ({ status: s })) });


/**
 * Partitions an array into even sets of n items. The last set may contain less than n.
 */
const partition = (n, items) => {
  if (n >= items.length) {
    return [items];
  }
  return [items.slice(0, n)].concat(partition(n, items.slice(n)));
};


/**
 * Allows testing a bunch of different examples with expected values
 * @param tester a function that will perform assertions taking args and expected
 * @param examples alternating pairs of input args and the expected result.
 */
const withExamples = (tester, ...examples) => {
  const exampleSets = partition(2, examples);
  exampleSets.map(([args, expected]) =>
    tester(args, expected)
  );
};

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

