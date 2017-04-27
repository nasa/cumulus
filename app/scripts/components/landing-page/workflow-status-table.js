import { connect } from 'react-redux';
import { Table, Column } from '../table';

const ws = require('../../reducers/workflow-status');
const functional = require('react-functional');
const React = require('react');
const { List } = require('immutable');
const JsTimeAgo = require('javascript-time-ago');
JsTimeAgo.locale(require('javascript-time-ago/locales/en'));
const timeAgo = new JsTimeAgo('en-US');

const SuccessIcon = () => <i className="fa fa-check-circle icon-green" aria-hidden="true" />;
const FailedIcon = () => <i className="fa fa-exclamation-triangle icon-red" aria-hidden="true" />;
const NotRunIcon = () => <i className="fa fa-circle-o icon-grey" aria-hidden="true" />;

/**
 * Returns a human readable time for when the last execution completed for the workflow.
 */
const lastCompleted = (workflow) => {
  const lastExecution = ws.getLastCompleted(workflow);
  if (lastExecution) {
    const icon = lastExecution.get('status') === 'SUCCEEDED' ? <SuccessIcon /> : <FailedIcon />;
    return <span>{icon}&nbsp;{timeAgo.format(lastExecution.get('stop_date'))}</span>;
  }
  return <span><NotRunIcon />&nbsp;not yet</span>;
};

/**
 * Returns the success ratio with any non running executions.
 */
const successRatio = (workflow) => {
  const { numSuccessful, numExecutions } = ws.getSuccessRate(workflow);
  return `${numSuccessful}/${numExecutions} Successful`;
};

/**
 * Return the number of running executions for display.
 */
const runningStatus = (workflow) => {
  const numRunning = ws.getNumRunning(workflow);
  return `${numRunning} Running`;
};


/**
 * Shows a loading icon while props.isLoading. Once loading is complete the children are shown.
 */
const Loading = (props) => {
  if (props.isLoading()) {
    return <i className="fa fa-circle-o-notch fa-spin fa-2x fa-fw" />;
  }

  return props.children;
};

/**
 * Creates a table containing all of the workflows configured in the system with their current
 * status.
 */
const WorkflowStatusTableFn = (props) => {
  const dispatch = props.dispatch;
  const { workflows, sort } = props.workflowStatus;
  return (
    <div>
      <h2>Workflow Status</h2>
      <Loading isLoading={() => !workflows}>
        <Table
          className="workflow-status-table"
          data={workflows || List()}
          sortDirectionAsc={sort.get('ascending')}
        >
          <Column
            header="Workflow Name"
            valueFn={r => r.get('name')}
            sorted={sort.get('field') === ws.SORT_NAME}
            sortHandler={_ => dispatch(ws.changeSort(ws.SORT_NAME))}
          />
          <Column
            header="Last Completed"
            valueFn={lastCompleted}
            sorted={sort.get('field') === ws.SORT_LAST_COMPLETED}
            sortHandler={_ => dispatch(ws.changeSort(ws.SORT_LAST_COMPLETED))}
          />
          <Column
            header="Success Ratio"
            valueFn={successRatio}
            sorted={sort.get('field') === ws.SORT_SUCCESS_RATE}
            sortHandler={_ => dispatch(ws.changeSort(ws.SORT_SUCCESS_RATE))}
          />
          <Column
            header="Status"
            valueFn={runningStatus}
            sorted={sort.get('field') === ws.SORT_NUM_RUNNING}
            sortHandler={_ => dispatch(ws.changeSort(ws.SORT_NUM_RUNNING))}
          />
        </Table>
      </Loading>
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
  ws.fetchWorkflowStatus(config, dispatch);
}

const WorkflowStatusTable = connect(workflowStatusStateToProps)(
  // Adds in the workflowStatusMount as a callback when the WorkflowStatusTable is mounted in React.
  functional(WorkflowStatusTableFn, { componentWillMount: workflowStatusMount }));

export { WorkflowStatusTable,
  // For Testing
  lastCompleted,
  successRatio,
  runningStatus,
  SuccessIcon,
  FailedIcon,
  NotRunIcon };
