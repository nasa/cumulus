'use strict';

const React = require('react');
import Header from '../header.js';

function AlertList () {
  return (
    <div>
      <h2>Alerts</h2>
      <ul className="alerts-list">
        <li className="eui-banner--danger"><strong>Error:</strong> MOPITT hasn't updated in 3 days.</li>
        <li className="eui-banner--warn"><strong>Warning:</strong> Ingest 95th percentile is &gt; 2s.</li>
      </ul>
    </div>
  );
}

function SystemStatus () {
  return (
    <div>
      <h2>System Status</h2>
      <ul className="system-stats-list">
        <li><strong>17</strong> Running Jobs</li>
        <li><strong>10</strong> Longest Queue (VNGCR_NQD_C1)</li>
        <li><strong>20</strong> Running Jobs (VNGCR_NQD_C1)</li>
      </ul>
    </div>
  );
}

function ProductStatusTable () {
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
            <td><i className="eui-icon eui-fa-minus-circle icon-red"></i> VIIRS</td>
            <td>10 minutes ago</td>
            <td>Ingesting 3 products</td>
            <td><i className="eui-icon eui-fa-minus-circle icon-red"></i><strong>20 minutes</strong></td>
            <td>5 minutes</td>
            <td><button type="button" className="eui-btn"><i className="eui-icon fa fa-refresh"></i>Reingest</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function LandingPage () {
  return (
    <div>
      <Header/>
      <main>
        <AlertList/>
        <SystemStatus/>
        <ProductStatusTable/>
      </main>
    </div>
  );
}

export default LandingPage;
