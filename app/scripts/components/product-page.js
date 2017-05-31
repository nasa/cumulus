const Header = require('./header').default;
const React = require('react');
const { Link } = require('react-router-dom');
const { SuccessPill, RunningPill, FailedPill } = require('./icon');


/**
 * LandingPage - The main landing page for the application.
 */
const ProductPage = (props) => {
  const productId = props.match.params.id;
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
        <h1>{productId}</h1>
        {/* TODO ingest performance */}
        <h2>Executions</h2>
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
        </ul>
      </main>
    </div>
  );
};

export default ProductPage;
