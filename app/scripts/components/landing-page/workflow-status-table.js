import { connect } from 'react-redux';
import { fetchWorkflowStatus } from '../../reducers/workflow-status';
import { Table, Column } from '../table';

const functional = require('react-functional');
const React = require('react');
const { List } = require('immutable');
const JsTimeAgo = require('javascript-time-ago');
JsTimeAgo.locale(require('javascript-time-ago/locales/en'));
const timeAgo = new JsTimeAgo('en-US');

/**
 * Returns all the exections in a workflow that are not running.
 */
const nonRunningExecutions = workflow =>
  workflow.get('executions')
  .filter(v => v.get('status') !== 'RUNNING');

/**
 * Returns a human readable time for when the last execution completed for the workflow.
 */
const lastCompleted = (workflow) => {
  const lastExecution = nonRunningExecutions(workflow).first();
  if (lastExecution) {
    // TODO add icon for whether the last one was successful or not.
    return <p>{timeAgo.format(lastExecution.get('start_date'))}</p>;
  }
  return 'Not yet';
};

/**
 * Returns the success ratio with any non running executions.
 */
const successRatio = (workflow) => {
  const executions = nonRunningExecutions(workflow);
  const numSuccessful = executions.filter(v => v.get('status') === 'SUCCEEDED').count();
  return `${numSuccessful}/${executions.count()} Successful`;
};

/**
 * Return the number of running executions for display.
 */
const runningStatus = (workflow) => {
  const executions = workflow.get('executions');
  const numRunning = executions.filter(v => v.get('status') === 'RUNNING').count();
  return `${numRunning} Running`;
};

/**
 * TODO table should be sortable
 */
const WorkflowStatusTableFn = (props) => {
  const { workflows } = props.workflowStatus;
  return (
    <div>
      <h2>Workflow Status</h2>
      <Table className="workflow-status-table" data={workflows || List()}>
        <Column
          header="Workflow Name"
          valueFn={r => r.get('name')}
        />
        <Column
          header="Last Completed"
          valueFn={lastCompleted}
        />
        <Column
          header="Success Ratio"
          valueFn={successRatio}
        />
        <Column
          header="Status"
          valueFn={runningStatus}
        />
      </Table>
    </div>
  );
};

/**
 * @returns The properties to send to the WorkflowStatusTable component
 */
const workflowStatusStateToProps = ({ config, workflowStatus }) => ({ config, workflowStatus });

/**
 * Handles the alert list being mounted by initiating a check to get the API health
 */
function workflowStatusMount({ config, dispatch }) {
  fetchWorkflowStatus(config, dispatch);
}

const WorkflowStatusTable = connect(workflowStatusStateToProps)(
  // Adds in the workflowStatusMount as a callback when the WorkflowStatusTable is mounted in React.
  functional(WorkflowStatusTableFn, { componentWillMount: workflowStatusMount }));

export { WorkflowStatusTable, lastCompleted, successRatio, runningStatus };
