import { connect } from 'react-redux';
import { fetchApiHealth } from '../../reducers/api-health';

const functional = require('react-functional');
const React = require('react');

/**
 * @returns an banner to show depending on the health of GIBS.
 */
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

/**
 * @returns A list of alerts signaling problems with GIBS.
 */
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

/**
 * @returns The properties to send to the AlertList component
 */
const alertListStateToProps = ({ config, apiHealth }) => ({ config, apiHealth });

/**
 * Handles the alert list being mounted by initiating a check to get the API health
 */
function alertListMount({ config, dispatch }) {
  fetchApiHealth(config, dispatch);
}

export default connect(alertListStateToProps)(
  // Adds in the alertListMount as a callback when the AlertList is mounted in React.
  functional(AlertListFn, { componentWillMount: alertListMount }),
);
