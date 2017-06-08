const React = require('react');
const { connect } = require('react-redux');
const functional = require('react-functional');
const { Link } = require('react-router-dom');
const { List, Map } = require('immutable');
const Header = require('./header').default;
const { Loading, RefreshButton } = require('./loading');
const { SuccessIcon, ErrorIcon, Icon } = require('./icon');
const { PerformanceChart } = require('./performance-chart');
const ps = require('../reducers/product-status');
const util = require('../util');

const ProcessingIcon = () => <Icon className="fa-refresh fa-spin fa-fw" />;

/* eslint-disable camelcase */

/**
 * Parses out the workflow id and product id from the location path of the page. Expected that it
 * will look like /workflows/:workflowId/products/:productId
 */
const parsePathIds = (props) => {
  const parts = props.location.pathname.split('/');
  const workflowId = parts[2];
  const productId = parts[4];
  return { workflowId, productId };
};


/**
 * @returns The properties to send to the TriggerReingestButton component
 */
const triggerReingestButtonStateToProps = ({ config, productStatus }) =>
  ({ config, productStatus });

/**
 * TODO
 */
const TriggerReingestButton = connect(triggerReingestButtonStateToProps)(
  ({ workflowId, granuleId, productId, config, productStatus, dispatch }) => {
    const { startingGranules, startedGranules } = productStatus.get('reingest');

    if (startingGranules.contains(granuleId)) {
      return <span><ProcessingIcon />Starting</span>;
    }
    if (startedGranules.contains(granuleId)) {
      return <span><SuccessIcon />Running</span>;
    }
    return (
      <button
        type="button"
        className="eui-btn eui-btn--sm"
        onClick={(e) => {
          e.preventDefault();
          ps.reingestGranule(config, workflowId, productId, granuleId, dispatch);
        }}
      >
        Reingest
      </button>
    );
  }
);

const RunningIcon = () => <Icon className="fa-repeat icon-running" />;

const RunningCell = () =>
  <td className="status-cell running-status">
    <RunningIcon />
    Running
  </td>;

const SuccessCell = () =>
  <td className="status-cell success-status">
    <SuccessIcon />
    Success
  </td>;

const FailCell = () =>
  <td className="status-cell fail-status">
    <ErrorIcon />
    Fail
  </td>;

/**
 * TODO
 */
const executionTableHeader = (
  <thead>
    <tr>
      <th>Status</th>
      <th>Reason</th>
      <th>Granule Id</th>
      <th>Started</th>
      <th>Stopped</th>
      <th>Duration</th>
      <th>Current Step</th>
      <th>Actions</th>
    </tr>
  </thead>
);

/**
 * TODO
 */
const rowClassName = index => (index % 2 === 0 ? 'even-row' : 'odd-row');

/**
 * TODO
 */
const rowKey = ({ granule_id, start_date }) => `${granule_id}-${start_date}`;

/**
 * TODO
 */
const RunningRow = ({ rowIndex, execution }) => {
  const { granule_id, start_date, current_state, reason } = execution;
  const msSinceStart = Date.now() - Date.parse(start_date);
  return (
    <tr
      className={rowClassName(rowIndex)}
    >
      <RunningCell />
      <td>{reason}</td>
      <td>
        {granule_id ? util.parseJulian(granule_id) : 'N/A'}
      </td>
      <td>{util.dateStringToLocaleString(start_date)}</td>
      <td />
      <td>{util.humanDuration(msSinceStart)}</td>
      <td>{current_state}</td>
      <td />
    </tr>
  );
};

/**
 * TODO
 */
const CompletedRow = ({ rowIndex, execution, productId, workflowId }) => {
  const { granule_id, start_date, stop_date, elapsed_ms, reason, success } = execution;
  return (
    <tr
      className={rowClassName(rowIndex)}
    >
      {success ? <SuccessCell /> : <FailCell />}
      <td>{reason}</td>
      <td>
        {granule_id ? util.parseJulian(granule_id) : 'N/A'}
      </td>
      <td>{util.dateStringToLocaleString(start_date)}</td>
      <td>{util.dateStringToLocaleString(stop_date)}</td>
      <td>{util.humanDuration(elapsed_ms)}</td>
      <td />
      <td>
        {
          granule_id ?
            <TriggerReingestButton
              workflowId={workflowId}
              granuleId={granule_id}
              productId={productId}
            />
            : ''
        }
      </td>
    </tr>
  );
};

/**
 * Returns a table containing information about the running and completed executions for the
 * product.
 */
const ExecutionTable = (props) => {
  const { running_executions, completed_executions } = props.productStatus;
  let rowIndex = -1;

  return (
    <table className="execution-table wide-table">
      {executionTableHeader}
      <tbody>
        {running_executions.map((exec) => {
          rowIndex += 1;
          return (<RunningRow key={rowKey(exec)} rowIndex={rowIndex} execution={exec} />);
        })}
        {completed_executions.map((exec) => {
          rowIndex += 1;
          return (
            <CompletedRow
              key={rowKey(exec)}
              rowIndex={rowIndex}
              execution={exec}
              workflowId={props.workflowId}
              productId={props.productId}
            />
          );
        })}
      </tbody>
    </table>
  );
};

/**
 * ProductPageFn - Shows a page for product execution information within a single workflow. Shows
 * currently running workflows and past executions along with past performance.
 */
const ProductPageFn = (props) => {
  const { config, dispatch } = props;
  const { workflowId, productId } = parsePathIds(props);
  const productStatus = props.productStatus.get('productStatus') || Map();
  return (
    <div>
      <Header />
      <main className="product-page">

        <div className="eui-breadcrumbs">
          <ol className="eui-breadcrumbs__list">
            <li className="eui-breadcrumbs__item"><Link to="/">Dashboard Home</Link></li>
            <li className="eui-breadcrumbs__item">{productId}</li>
          </ol>
        </div>

        <h1>{workflowId} {productId}</h1>
        <Loading isLoading={() => !props.productStatus.get('productStatus')}>
          <div>
            <PerformanceChart
              title={`${workflowId} Workflow ${productId} Performance`}
              perfData={productStatus.get('performance', List())}
            />
            <h2>
              Executions
              <RefreshButton
                reloading={props.productStatus.get('inFlight')}
                onClick={(e) => {
                  e.preventDefault();
                  ps.fetchProductStatus(config, workflowId, productId, dispatch);
                }}
              />
            </h2>
            <ExecutionTable
              productStatus={productStatus}
              productId={productId}
              workflowId={workflowId}
            />
          </div>
        </Loading>
      </main>
    </div>
  );
};

/**
 * @returns The properties to send to the ProductStatus component
 */
const productPageStateToProps = ({ config, match, productStatus }) =>
  ({ config, match, productStatus });

/**
 * Handles the product status component being mounted to cause a fetch for product status.
 */
const productPageMount = (props) => {
  const { config, dispatch } = props;
  const { workflowId, productId } = parsePathIds(props);
  return ps.fetchProductStatus(config, workflowId, productId, dispatch);
};

const ProductPage = connect(productPageStateToProps)(
 functional(ProductPageFn, { componentWillMount: productPageMount }));

module.exports = {
  ProductPage,
  // Testing
  parsePathIds
};
