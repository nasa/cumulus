import { connect } from 'react-redux';
import { Map } from 'immutable';
import Header from '../header';
import { getApiHealth } from '../../api-health';

const functional = require('react-functional');
const React = require('react');


const chooseApiHealthBanner = ({ healthy, inFlight, error }) => {
  if (!inFlight && healthy !== undefined) {
    if (healthy) {
      return (
        <li className="eui-banner--success">
          <strong>API Success:&nbsp;</strong>
          The API is healthy.</li>
      );
    }

    return (
      <li className="eui-banner--danger">
        <strong>API Error:&nbsp;</strong>{error || 'unknown problem'}</li>
    );
  }
  return null;
};

function AlertListFn({ apiHealth }) {
  return (
    <div>
      <h2>Alerts</h2>
      <ul className="alerts-list">
        {chooseApiHealthBanner(apiHealth)}
        <li className="eui-banner--danger">
          <strong>Error:&nbsp;</strong>
          MOPITT hasn&quot;t updated in 3 days.</li>
        <li className="eui-banner--warn">
          <strong>Warning:&nbsp;</strong>
          Ingest 95th percentile is &gt; 2s.</li>
      </ul>
    </div>
  );
}

const alertListStateToProps = ({ config, apiHealth }) => ({ config, apiHealth });

function alertListMount({ config, dispatch }) {
  getApiHealth(config, dispatch);
}

const AlertList = connect(alertListStateToProps)(
  functional(AlertListFn, { componentWillMount: alertListMount }),
);


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
              <button type="button" className="eui-btn"><i className="eui-icon fa fa-refresh" />Reingest</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

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
