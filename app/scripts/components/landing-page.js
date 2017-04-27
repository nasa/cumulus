const Header = require('./header').default;
// Commented out import of mocked component
// import AlertList from './landing-page/alert-list';
const { WorkflowStatusTable } = require('./landing-page/workflow-status-table');
const React = require('react');

// A mocked up system status component. This is commented out for now. The code is kept here until
// we implement it for real.
// /**
//  * SystemStatus - A section describing some statistics about the state of the system.
//  */
// function SystemStatus() {
//   return (
//     <div>
//       <h2>System Status</h2>
//       <ul className="system-stats-list">
//         <li>
//           <strong>17&nbsp;</strong>
//         Running Jobs</li>
//         <li>
//           <strong>10&nbsp;</strong>
//         Longest Queue (VNGCR_NQD_C1)</li>
//         <li>
//           <strong>20&nbsp;</strong>
//         Running Jobs (VNGCR_NQD_C1)</li>
//       </ul>
//     </div>
//   );
// }

/**
 * LandingPage - The main landing page for the application.
 */
const LandingPage = () =>
  <div>
    <Header />
    <main>
      {/* Commenting out mocked up pages until we implement them for real. */}
      {/* <AlertList /> */}
      {/* <SystemStatus /> */}
      <WorkflowStatusTable />
    </main>
  </div>;

export default LandingPage;
