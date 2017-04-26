import { connect } from 'react-redux';
import { Table, Column } from '../table';

const workflowStatus = require('../../reducers/workflow-status');
const functional = require('react-functional');
const React = require('react');
const { List } = require('immutable');
const JsTimeAgo = require('javascript-time-ago');
JsTimeAgo.locale(require('javascript-time-ago/locales/en'));
const timeAgo = new JsTimeAgo('en-US');

/**
 * Returns a human readable time for when the last execution completed for the workflow.
 */
const lastCompleted = (workflow) => {
  const lastExecution = workflowStatus.getLastCompleted(workflow);
  if (lastExecution) {
    // TODO add icon for whether the last one was successful or not.
    return timeAgo.format(lastExecution.get('stop_date'));
  }
  return 'Not yet';
};

/**
 * Returns the success ratio with any non running executions.
 */
const successRatio = (workflow) => {
  const { numSuccessful, numExecutions } = workflowStatus.getSuccessRate(workflow);
  return `${numSuccessful}/${numExecutions} Successful`;
};

/**
 * Return the number of running executions for display.
 */
const runningStatus = (workflow) => {
  const numRunning = workflowStatus.getNumRunning(workflow);
  return `${numRunning} Running`;
};

/**
 * TODO table should be sortable
 */
const WorkflowStatusTableFn = (props) => {
  const dispatch = props.dispatch;
  const { workflows, sort } = props.workflowStatus;
  return (
    <div>
      <h2>Workflow Status</h2>
      <Table
        className="workflow-status-table"
        data={workflows || List()}
        sortDirectionAsc={sort.get('ascending')}
      >
        <Column
          sorted={sort.get('field') === workflowStatus.SORT_NAME}
          sortHandler={_ => dispatch(workflowStatus.changeSort(workflowStatus.SORT_NAME))}
          header="Workflow Name"
          valueFn={r => r.get('name')}
        />
        <Column
          sorted={sort.get('field') === workflowStatus.SORT_LAST_COMPLETED}
          sortHandler={_ => dispatch(workflowStatus.changeSort(workflowStatus.SORT_LAST_COMPLETED))}
          header="Last Completed"
          valueFn={lastCompleted}
        />
        <Column
          sorted={sort.get('field') === workflowStatus.SORT_SUCCESS_RATE}
          sortHandler={_ => dispatch(workflowStatus.changeSort(workflowStatus.SORT_SUCCESS_RATE))}
          header="Success Ratio"
          valueFn={successRatio}
        />
        <Column
          sorted={sort.get('field') === workflowStatus.SORT_NUM_RUNNING}
          sortHandler={_ => dispatch(workflowStatus.changeSort(workflowStatus.SORT_NUM_RUNNING))}
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
  workflowStatus.fetchWorkflowStatus(config, dispatch);
}

const WorkflowStatusTable = connect(workflowStatusStateToProps)(
  // Adds in the workflowStatusMount as a callback when the WorkflowStatusTable is mounted in React.
  functional(WorkflowStatusTableFn, { componentWillMount: workflowStatusMount }));

export { WorkflowStatusTable, lastCompleted, successRatio, runningStatus };
