const React = require('react');
const { connect } = require('react-redux');
const functional = require('react-functional');
const { Link } = require('react-router-dom');
const Header = require('./header').default;
const { Loading } = require('./loading');
const { SuccessPill, RunningPill, FailedPill } = require('./icon');
const ps = require('../reducers/product-status');
const util = require('../util');

const parsePathIds = (props) => {
  const parts = props.location.pathname.split('/');
  const workflowId = parts[2];
  const productId = parts[4];
  return { workflowId, productId };
};

// TODO the presence of the last pages product status causes this to show the old stuff
// first before showing the correct data.

/**
 * TODO
 */
const ExecutionList = (props) => {
  const { running_executions, completed_executions } = props.productStatus;
  return (
    <ul className="execution-list">
      {running_executions.map((exec) => {
        const msSinceStart = Date.now() - Date.parse(exec.get('start_date'));

        return (
          <li className="execution-list-element">
            <div className="execution-list-element-header">
              <RunningPill />
              <span className="execution-granule-id">{exec.get('granule_id')}</span>
            </div>
            <ul className="execution-details-list">
              <li>
                <span className="details-list-label">Started:</span>
                {util.dateStringToLocaleString(exec.get('start_date'))}
              </li>
              <li>
                <span className="details-list-label">Duration:</span>
                {util.humanDuration(msSinceStart)}
              </li>
              <li>
                <span className="details-list-label">Current Step:</span>
                {exec.get('current_state')}
              </li>
            </ul>
          </li>
        );
      })}
      {completed_executions.map(exec =>
        <li className="execution-list-element">
          <div className="execution-list-element-header">
            {exec.get('success') ? <SuccessPill /> : <FailedPill />}
            <span className="execution-granule-id">{exec.get('granule_id')}</span>
          </div>
          <ul className="execution-details-list">
            <li>
              <span className="details-list-label">Started:</span>
              {util.dateStringToLocaleString(exec.get('start_date'))}
            </li>
            <li>
              <span className="details-list-label">Ended:</span>
              {util.dateStringToLocaleString(exec.get('stop_date'))}
            </li>
            <li>
              <span className="details-list-label">Elapsed:</span>
              {util.humanDuration(exec.get('elapsed_ms'))}
            </li>
          </ul>
        </li>
      )}
    </ul>
  );
};

const mockExecutions =
<ul className="execution-list">
  <li className="execution-list-element">
    <div className="execution-list-element-header">
      <RunningPill />
      <span className="execution-granule-id">2017-05-30</span>
    </div>
    <ul className="execution-details-list">
      <li><span className="details-list-label">Started:</span> 5/30/2017, 11:29:23 AM</li>
      <li><span className="details-list-label">Duration:</span> 20 minutes</li>
      <li><span className="details-list-label">Current Step:</span> MRF Gen</li>
    </ul>
  </li>
  <li className="execution-list-element">
    <div className="execution-list-element-header">
      <SuccessPill />
      <span className="execution-granule-id">2017-05-30</span>
    </div>
    <ul className="execution-details-list">
      <li><span className="details-list-label">Started:</span> 5/30/2017, 11:29:23 AM</li>
      <li><span className="details-list-label">Ended:</span> 5/30/2017, 11:29:23 AM</li>
      <li><span className="details-list-label">Elapsed:</span> 27 seconds</li>
    </ul>
  </li>
  <li className="execution-list-element">
    <div className="execution-list-element-header">
      <FailedPill />
      <span className="execution-granule-id">2017-05-30</span>
    </div>
    <ul className="execution-details-list">
      <li><span className="details-list-label">Started:</span> 5/30/2017, 11:29:23 AM</li>
      <li><span className="details-list-label">Ended:</span> 5/30/2017, 11:29:23 AM</li>
      <li><span className="details-list-label">Elapsed:</span> 27 seconds</li>
    </ul>
  </li>
</ul>;

/**
 * LandingPage - The main landing page for the application.
 */
const ProductPageFn = (props) => {
  const { workflowId, productId } = parsePathIds(props);
  console.log(props);
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

        <h1>Collection {productId}</h1>

        {/* TODO ingest performance */}

        <h2>Executions</h2>
        <Loading isLoading={() => !props.productStatus.get('productStatus')}>
          <ExecutionList productStatus={props.productStatus.get('productStatus')} />
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

export default ProductPage;
