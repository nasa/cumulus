import { connect } from 'react-redux';
import { fetchWorkflowStatus } from '../../reducers/workflow-status';
import { Table, Column } from '../table';

const functional = require('react-functional');
const React = require('react');
const { List } = require('immutable');
const JsTimeAgo = require('javascript-time-ago');
JsTimeAgo.locale(require('javascript-time-ago/locales/en'));
const timeAgo = new JsTimeAgo('en-US');

// TODO add tests for stateless functions

/**
 * TODO
 */
const lastCompleted = (workflow) => {
  const lastExecution = workflow.get('executions')
    .filter(v => v.get('status') !== 'RUNNING')
    .first();
  if (lastExecution) {
    // TODO add icon for whether the last one was successful or not.
    return timeAgo.format(lastExecution.get('start_date'));
  }
  return 'Not yet';
};

/**
 * TODO
 */
const successRatio = (workflow) => {
  const executions = workflow.get('executions');
  const numSuccessful = executions.filter(v => v.get('status') === 'SUCCEEDED').count();
  return `${numSuccessful}/${executions.count()} Successful`;
};


/**
 * TODO
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

export default connect(workflowStatusStateToProps)(
  // Adds in the workflowStatusMount as a callback when the WorkflowStatusTable is mounted in React.
  functional(WorkflowStatusTableFn, { componentWillMount: workflowStatusMount }));
