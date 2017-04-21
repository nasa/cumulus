import Header from '../header';
import AlertList from './alert-list';
const React = require('react');

/**
 * SystemStatus - A section describing some statistics about the state of the system.
 */
function SystemStatus() {
  return (
    <div>
      <h2>System Status</h2>
      <ul className="system-stats-list">
        <li>
          <strong>17&nbsp;</strong>
          Running Jobs</li>
        <li>
          <strong>10&nbsp;</strong>
          Longest Queue (VNGCR_NQD_C1)</li>
        <li>
          <strong>20&nbsp;</strong>
          Running Jobs (VNGCR_NQD_C1)</li>
      </ul>
    </div>
  );
}

/**
 * ProductStatusTable - A table listing various information about the products that are configured
 * in GIBS.
 */
function ProductStatusTable() {
  return (
    <div>
      <h2>Product Status</h2>
      <table className="product-status-table">
        <thead>
          <tr>
            <th>Product Type</th>
            <th>Last Ingest</th>
            <th>Status</th>
            <th>95th Perc. Ingest Time (24h)</th>
            <th>95th Perc. Ingest Time (30d)</th>
            <th>Reingest</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><i className="eui-icon eui-fa-minus-circle icon-red" />
              VIIRS</td>
            <td>10 minutes ago</td>
            <td>Ingesting 3 products</td>
            <td><i className="eui-icon eui-fa-minus-circle icon-red" />
              <strong>20 minutes</strong>
            </td>
            <td>5 minutes</td>
            <td>
              <button type="button" className="eui-btn">
                <i className="eui-icon fa fa-refresh" />Reingest
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


/**
 * LandingPage - The main landing page for the application.
 */
function LandingPage() {
  return (
    <div>
      <Header />
      <main>
        <AlertList />
        <SystemStatus />
        <ProductStatusTable />
      </main>
    </div>
  );
}

export default LandingPage;
