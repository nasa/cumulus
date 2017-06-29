const Header = require('./header').default;
// Commented out import of mocked component
// const AlertList = require('./landing-page/alert-list').default;
const React = require('react');
const { WorkflowStatusTable } = require('./landing-page/workflow-status-table');
const { ServiceStatus } = require('./landing-page/service-status');


/**
 * LandingPage - The main landing page for the application.
 */
const LandingPage = () =>
  <div>
    <Header />
    <main>
      {/* Commenting out mocked up pages until we implement them for real. */}
      {/* <AlertList /> */}
      <ServiceStatus />
      <WorkflowStatusTable />
    </main>
  </div>;

export default LandingPage;
