import Header from './header';
import AlertList from './landing-page/alert-list';
import WorkflowStatusTable from './landing-page/workflow-status-table';
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
 * LandingPage - The main landing page for the application.
 */
function LandingPage() {
  return (
    <div>
      <Header />
      <main>
        <AlertList />
        <SystemStatus />
        <WorkflowStatusTable />
      </main>
    </div>
  );
}

export default LandingPage;
