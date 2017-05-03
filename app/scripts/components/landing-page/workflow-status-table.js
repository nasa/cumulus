const React = require('react');
const CSSTransitionGroup = require('react-transition-group/CSSTransitionGroup');
const { List } = require('immutable');
const { connect } = require('react-redux');
const functional = require('react-functional');
const ws = require('../../reducers/workflow-status');
const Icon = require('../icon');

const JsTimeAgo = require('javascript-time-ago');
JsTimeAgo.locale(require('javascript-time-ago/locales/en'));
const timeAgo = new JsTimeAgo('en-US');

const SuccessIcon = () => <Icon className="fa-check-circle icon-success" />;
const FailedIcon = () => <Icon className="fa-exclamation-triangle icon-alert" />;
const NotRunIcon = () => <Icon className="fa-circle-o icon-disabled" />;

/**
 *  Icon to represent collapsed and expanded workflow rows
 */
const ExpandableRowIcon = ({ isExpanded }) => {
  if (isExpanded) {
    return <Icon className="fa-angle-down expandable-icon" />;
  }
  return <Icon className="fa-angle-right expandable-icon" />;
};

/**
 * Returns the icon indicating the direction of the sort on the column.
 */
const SortIcon = ({ isSorted, sortDirectionAsc }) => {
  if (isSorted) {
    if (sortDirectionAsc) {
      return <Icon className="icon-sort fa-sort-down" />;
    }
    return <Icon className="icon-sort fa-sort-up" />;
  }
  return <Icon className="icon-sort fa-sort" />;
};

/**
 * Returns a human readable time for when the last execution completed for the workflow.
 */
const lastCompleted = (workflow) => {
  const lastExecution = ws.getLastCompleted(workflow);
  if (lastExecution) {
    const icon = lastExecution.get('status') === 'SUCCEEDED' ? <SuccessIcon /> : <FailedIcon />;
    return <span>{icon}{timeAgo.format(lastExecution.get('stop_date'))}</span>;
  }
  return <span><NotRunIcon />not yet</span>;
};

/**
 * Returns the success ratio with any non running executions.
 */
const successRatio = (workflow) => {
  const { numSuccessful, numExecutions } = ws.getSuccessRate(workflow);
  return `${numSuccessful} of the last ${numExecutions} successful`;
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
    return <Icon className="fa-circle-o-notch fa-spin fa-2x fa-fw" />;
  }

  return props.children;
};

/**
 * TODO
 */
const WorkflowTbody = connect()((props) => {
  const { workflow, dispatch } = props;
  const expanded = workflow.get('expanded', false);
  return (
    <tbody key={workflow.get('name')} className="workflow-body">
      <tr>
        <td className="name-cell">
          <a
            className="button-cell"
            role="button" href="/" onClick={(e) => {
              e.preventDefault();
              dispatch(ws.collapseExpandWorkflow(workflow));
            }}
          >
            <ExpandableRowIcon isExpanded={expanded} />
            {workflow.get('name')}
          </a>
        </td>
        <td>{lastCompleted(workflow)}</td>
        <td />
        <td>{successRatio(workflow)}</td>
        <td>{runningStatus(workflow)}</td>
        <td />
      </tr>
    </tbody>
  );
});

const cannedRows = () =>
  [<tr key="product-1">
    <td className="name-cell">
      <div>VIIRS_SNPP_CorrectedReflectance_TrueColor_v1_NRT (VNGCR_LQD_C1)</div>
    </td>
    <td>
      <div>
        <i className="icon fa fa-check-circle icon-success" aria-hidden="true" />
        XX minutes ago
      </div>
    </td>
    <td><div>X hours ago</div></td>
    <td><div>XX of the last XX successful</div></td>
    <td><div>X Running</div></td>
    <td><div>chart.js chart here</div></td>
  </tr>,
    <tr key="product-2">
      <td className="name-cell">
        <div>VIIRS_SNPP_CorrectedReflectance_TrueColor_v1_NRT (VNGCR_SQD_C1)</div>
      </td>
      <td>
        <div>
          <i className="icon fa fa-check-circle icon-success" aria-hidden="true" />
          XX minutes ago
        </div>
      </td>
      <td><div>X hours ago</div></td>
      <td><div>XX of the last XX successful</div></td>
      <td><div>X Running</div></td>
      <td><div>chart.js chart here</div></td>
    </tr>,
    <tr key="product-3">
      <td className="name-cell">
        <div>VIIRS_SNPP_CorrectedReflectance_TrueColor_v1_NRT (VNGCR_NQD_C1)</div>
      </td>
      <td>
        <div>
          <i className="icon fa fa-check-circle icon-success" aria-hidden="true" />
          XX minutes ago
        </div>
      </td>
      <td><div>X hours ago</div></td>
      <td><div>XX of the last XX successful</div></td>
      <td><div>X Running</div></td>
      <td><div>chart.js chart here</div></td>
    </tr>];

/**
 * TODO
 */
const ProductTbody = ({ workflow }) => {
  const rows = workflow.get('expanded', false) ? cannedRows() : null;
  return (
    <CSSTransitionGroup
      transitionName="products"
      transitionEnterTimeout={300}
      transitionLeaveTimeout={300}
      component="tbody"
      key={`${workflow.get('name')}-products`}
      className="product-body"
    >
      {rows}
    </CSSTransitionGroup>
  );
};

/**
 * TODO
 */
const Th = (props) => {
  if (props.sortHandler) {
    return (
      <th className={props.className}>
        <a
          className="button-cell"
          role="button" href="/" onClick={(e) => {
            e.preventDefault();
            props.sortHandler();
          }}
        >
          {props.title}
          <SortIcon isSorted={props.isSorted} sortDirectionAsc={props.sortDirectionAsc} />
        </a>
      </th>
    );
  }
  // No sorting needed
  return <th>{props.title}</th>;
};


/**
 * Creates a table containing all of the workflows configured in the system with their current
 * status.
 */
const WorkflowStatusTableFn = (props) => {
  const dispatch = props.dispatch;
  const sort = props.workflowStatus.get('sort');
  const workflows = props.workflowStatus.get('workflows') || List();
  return (
    <div>
      <h2>Workflow Status</h2>
      <Loading isLoading={() => !props.workflowStatus.get('workflows')}>
        <table
          className="workflow-status-table"
        >
          <thead>
            <tr>
              <Th
                className="name-cell"
                title="Name"
                isSorted={sort.get('field') === ws.SORT_NAME}
                sortDirectionAsc={sort.get('ascending')}
                sortHandler={_ => dispatch(ws.changeSort(ws.SORT_NAME))}
              />
              <Th
                title="Last Completed"
                isSorted={sort.get('field') === ws.SORT_LAST_COMPLETED}
                sortDirectionAsc={sort.get('ascending')}
                sortHandler={_ => dispatch(ws.changeSort(ws.SORT_LAST_COMPLETED))}
              />
              <Th
                title="Most Recent Temporal Date"
                isSorted={sort.get('field') === ws.SORT_RECENT_TEMPORAL}
                sortDirectionAsc={sort.get('ascending')}
                sortHandler={_ => dispatch(ws.changeSort(ws.SORT_RECENT_TEMPORAL))}
              />
              <Th
                title="Recent Run Success Ratio"
                isSorted={sort.get('field') === ws.SORT_SUCCESS_RATE}
                sortDirectionAsc={sort.get('ascending')}
                sortHandler={_ => dispatch(ws.changeSort(ws.SORT_SUCCESS_RATE))}
              />
              <Th
                title="Status"
                isSorted={sort.get('field') === ws.SORT_NUM_RUNNING}
                sortDirectionAsc={sort.get('ascending')}
                sortHandler={_ => dispatch(ws.changeSort(ws.SORT_NUM_RUNNING))}
              />
              <Th
                title="Ingest Performance"
              />
            </tr>
          </thead>
          {workflows.map(w =>
            [<WorkflowTbody workflow={w} />, <ProductTbody workflow={w} />]
          )}

        </table>
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
const workflowStatusMount = ({ config, dispatch }) => ws.fetchWorkflowStatus(config, dispatch);

const WorkflowStatusTable = connect(workflowStatusStateToProps)(
  // Adds in the workflowStatusMount as a callback when the WorkflowStatusTable is mounted in React.
  functional(WorkflowStatusTableFn, { componentWillMount: workflowStatusMount }));

module.exports = { WorkflowStatusTable,
  // For Testing
  lastCompleted,
  successRatio,
  runningStatus,
  SuccessIcon,
  FailedIcon,
  NotRunIcon };
