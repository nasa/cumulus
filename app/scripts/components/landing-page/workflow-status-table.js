const React = require('react');
const CSSTransitionGroup = require('react-transition-group/CSSTransitionGroup');
const { connect } = require('react-redux');
const { Link } = require('react-router-dom');
const functional = require('react-functional');
const { List } = require('immutable');
const { Icon, SuccessIcon, ErrorIcon } = require('../icon');
const { Loading } = require('../loading');
const { InlineClickableIngestChart } = require('../ingest-chart');
const ws = require('../../reducers/workflow-status');
const util = require('../../util');

const NotRunIcon = () => <Icon className="fa-circle-o icon-disabled" />;

/* eslint-disable camelcase */

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
const lastCompleted = (lastExecution) => {
  if (lastExecution) {
    const icon = lastExecution.get('success') ? <SuccessIcon /> : <ErrorIcon />;
    return <span>{icon}{util.humanTimeSince(lastExecution.get('stop_date'))}</span>;
  }
  return <span><NotRunIcon />not yet</span>;
};

/**
 * Returns information about recent number of failures or successes.
 */
const recentExecutions = (workflow) => {
  const { numFailed, numExecutions } = ws.getSuccessRate(workflow);
  if (numExecutions === 0) {
    return <span><NotRunIcon />No runs yet.</span>;
  }
  if (numFailed > 0) {
    return <span><ErrorIcon />{`${numFailed} failures out of recent ${numExecutions}`}</span>;
  }
  return <span><SuccessIcon />{`${numExecutions} recent successful runs`}</span>;
};

/**
 * Return the number of running executions for display.
 */
const runningStatus = (workflow) => {
  const numRunning = ws.getNumRunning(workflow);
  return `${numRunning} Running`;
};

/**
 * Defines the table body that displays workflow information
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
        <td>{lastCompleted(ws.getLastCompleted(workflow))}</td>
        <td />
        <td>{recentExecutions(workflow)}</td>
        <td>{runningStatus(workflow)}</td>
        <td>
          <InlineClickableIngestChart
            title={`${workflow.get('id')} Workflow`}
            ingestPerf={workflow.get('ingest_perf', List())}
            guid={workflow.get('id')}
          />
        </td>
      </tr>
    </tbody>
  );
});

/**
 * Defines a single row showing product information.
 */
const ProductRow = ({ workflow, product }) => {
  const productId = product.get('id');
  const workflowId = workflow.get('id');
  const { last_execution, last_granule_id, num_running, ingest_perf } = product;
  return (
    <tr key={productId}>
      <td className="name-cell">
        <div>
          <Link to={`/workflows/${workflowId}/products/${productId}`}>{productId}</Link>
        </div>
      </td>
      <td><div>{lastCompleted(last_execution)}</div></td>
      <td>
        <div>
          {last_granule_id ? util.parseJulian(last_granule_id) : 'N/A'}
        </div>
      </td>
      <td><div>{recentExecutions(product)}</div></td>
      <td><div>{num_running} Running</div></td>
      <td>
        <div>
          <InlineClickableIngestChart
            title={`${workflowId} Workflow - ${productId}`}
            ingestPerf={ingest_perf}
            guid={`${workflowId}-${productId}`}
          />
        </div>
      </td>
    </tr>
  );
};

/**
 * Defines the table body that displays product information for all of the products in a workflow.
 * Uses CSS transitions to hide the table body until the workflow is clicked.
 */
const ProductTbody = ({ workflow }) => {
  const rows = workflow.get('expanded', false) ?
    workflow.get('products', List()).map(p =>
      <ProductRow key={p.get('id')} workflow={workflow} product={p} />
    ).toArray()
    : null;
  return (
    <CSSTransitionGroup
      transitionName="products"
      transitionEnterTimeout={150}
      transitionLeaveTimeout={150}
      component="tbody"
      key={`${workflow.get('name')}-products`}
      className="product-body"
    >
      {rows}
    </CSSTransitionGroup>
  );
};

/**
 * Defines a single table header that is sortable.
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
          className="workflow-status-table wide-table"
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
                title="Recent Executions"
                isSorted={sort.get('field') === ws.SORT_RECENT_EXECUTIONS}
                sortDirectionAsc={sort.get('ascending')}
                sortHandler={_ => dispatch(ws.changeSort(ws.SORT_RECENT_EXECUTIONS))}
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
  runningStatus,
  NotRunIcon };
