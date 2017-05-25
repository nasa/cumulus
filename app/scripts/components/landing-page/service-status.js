const React = require('react');
const { connect } = require('react-redux');
const functional = require('react-functional');
const { SuccessIcon, ErrorIcon } = require('../icon');
const { Loading } = require('../loading');
const { List, Map } = require('immutable');
const ss = require('../../reducers/service-status');

const JsTimeAgo = require('javascript-time-ago');
JsTimeAgo.locale(require('javascript-time-ago/locales/en'));
const timeAgo = new JsTimeAgo('en-US');

const serviceNameToHumanName = Map({
  GenerateMrf: 'MRF Generator',
  SfnScheduler: 'Scheduler',
  OnEarth: 'OnEarth'
});

const mockServicEvents =
`
2017-05-21T11:21:26.996Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T11:21:14.072Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task a488d043-1705-4e30-aed3-19889d032822) (task 763b92ac-d6f7-4987-8a00-83673dd15bf9).
2017-05-21T10:56:50.861Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T10:56:40.417Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 0a990536-328c-4a54-9a3d-07c03743ea85) (task 2c53cf0e-de4f-4012-8e02-3d164524c08f).
2017-05-21T06:27:08.021Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T00:27:02.706Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T18:26:46.847Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T12:26:30.768Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T06:26:10.609Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T00:26:07.994Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-19T18:25:52.970Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-19T18:24:36.134Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 2a269675-77ff-4250-a5dc-c8f517f5c2f2) (task 83ed912e-bc3e-400d-a615-1c68a59e81e5).
2017-05-19T18:23:00.496Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) was unable to place a task because no container instance met all of its requirements. Reason: No Container Instances were found in your cluster. For more information, see the Troubleshooting section of the Amazon ECS Developer Guide.
2017-05-21T11:21:26.996Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T11:21:14.072Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task a488d043-1705-4e30-aed3-19889d032822) (task 763b92ac-d6f7-4987-8a00-83673dd15bf9).
2017-05-21T10:56:50.861Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T10:56:40.417Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 0a990536-328c-4a54-9a3d-07c03743ea85) (task 2c53cf0e-de4f-4012-8e02-3d164524c08f).
2017-05-21T06:27:08.021Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T00:27:02.706Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T18:26:46.847Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T12:26:30.768Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T06:26:10.609Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T00:26:07.994Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-19T18:25:52.970Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-19T18:24:36.134Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 2a269675-77ff-4250-a5dc-c8f517f5c2f2) (task 83ed912e-bc3e-400d-a615-1c68a59e81e5).
2017-05-19T18:23:00.496Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) was unable to place a task because no container instance met all of its requirements. Reason: No Container Instances were found in your cluster. For more information, see the Troubleshooting section of the Amazon ECS Developer Guide.
2017-05-21T11:21:26.996Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T11:21:14.072Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task a488d043-1705-4e30-aed3-19889d032822) (task 763b92ac-d6f7-4987-8a00-83673dd15bf9).
2017-05-21T10:56:50.861Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T10:56:40.417Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 0a990536-328c-4a54-9a3d-07c03743ea85) (task 2c53cf0e-de4f-4012-8e02-3d164524c08f).
2017-05-21T06:27:08.021Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T00:27:02.706Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T18:26:46.847Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T12:26:30.768Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T06:26:10.609Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T00:26:07.994Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-19T18:25:52.970Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-19T18:24:36.134Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 2a269675-77ff-4250-a5dc-c8f517f5c2f2) (task 83ed912e-bc3e-400d-a615-1c68a59e81e5).
2017-05-19T18:23:00.496Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) was unable to place a task because no container instance met all of its requirements. Reason: No Container Instances were found in your cluster. For more information, see the Troubleshooting section of the Amazon ECS Developer Guide.
2017-05-21T11:21:26.996Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T11:21:14.072Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task a488d043-1705-4e30-aed3-19889d032822) (task 763b92ac-d6f7-4987-8a00-83673dd15bf9).
2017-05-21T10:56:50.861Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T10:56:40.417Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 0a990536-328c-4a54-9a3d-07c03743ea85) (task 2c53cf0e-de4f-4012-8e02-3d164524c08f).
2017-05-21T06:27:08.021Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T00:27:02.706Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T18:26:46.847Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T12:26:30.768Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T06:26:10.609Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T00:26:07.994Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-19T18:25:52.970Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-19T18:24:36.134Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 2a269675-77ff-4250-a5dc-c8f517f5c2f2) (task 83ed912e-bc3e-400d-a615-1c68a59e81e5).
2017-05-19T18:23:00.496Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) was unable to place a task because no container instance met all of its requirements. Reason: No Container Instances were found in your cluster. For more information, see the Troubleshooting section of the Amazon ECS Developer Guide.
2017-05-21T11:21:26.996Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T11:21:14.072Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task a488d043-1705-4e30-aed3-19889d032822) (task 763b92ac-d6f7-4987-8a00-83673dd15bf9).
2017-05-21T10:56:50.861Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T10:56:40.417Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 0a990536-328c-4a54-9a3d-07c03743ea85) (task 2c53cf0e-de4f-4012-8e02-3d164524c08f).
2017-05-21T06:27:08.021Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-21T00:27:02.706Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T18:26:46.847Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T12:26:30.768Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T06:26:10.609Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-20T00:26:07.994Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-19T18:25:52.970Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.
2017-05-19T18:24:36.134Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 2a269675-77ff-4250-a5dc-c8f517f5c2f2) (task 83ed912e-bc3e-400d-a615-1c68a59e81e5).
2017-05-19T18:23:00.496Z - (service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) was unable to place a task because no container instance met all of its requirements. Reason: No Container Instances were found in your cluster. For more information, see the Troubleshooting section of the Amazon ECS Developer Guide.
`;

/* eslint-disable camelcase */

const showModalButtonId = serviceName => `btn-show-${serviceName}-events`;
const modalDivId = serviceName => `modal-service-events-${serviceName}`;

/**
 * TODO
 */
const ViewEventsButton = ({ serviceName }) =>
  <button
    type="button"
    className="eui-btn eui-btn--sm"
    id={showModalButtonId(serviceName)}
    name={modalDivId(serviceName)}
    href={`#${modalDivId(serviceName)}`}
  >
    View Events
  </button>;

/**
 * TODO
 */
const ServiceEventsModalFn = ({ service }) => {
  const serviceName = service.get('service_name');
  const humanServiceName = serviceNameToHumanName.get(serviceName);
  return (
    <span>
      <ViewEventsButton serviceName={serviceName} />
      <div className="eui-modal-content wide-modal" id={modalDivId(serviceName)}>
        <h2>{humanServiceName} Events</h2>
        <pre className="eui-info-box modal-pre">{mockServicEvents}</pre>
      </div>
    </span>
  );
};

/**
 * TODO
 */
const ServiceEventsModal = functional(
  ServiceEventsModalFn, {
    componentDidMount: ({ service }) => {
      const serviceName = service.get('service_name');
      // Use EUI recommended method for creating modal content.
      // eslint-disable-next-line no-undef
      $(`#${showModalButtonId(serviceName)}`).leanModal();
    }
  }
);

/**
 * Shows the status of a single service.
 */
const SingleServiceStatus = ({ service }) => {
  const { desired_count, service_name, running_tasks } = service;
  const humanServiceName = serviceNameToHumanName.get(service_name);
  const numRunning = running_tasks.count();
  const mostRecentStartDate = running_tasks.map(({ started_at }) => Date.parse(started_at)).max();
  let serviceIcon = <SuccessIcon />;
  if (numRunning !== desired_count) {
    serviceIcon = <ErrorIcon />;
  }
  let text;
  if (numRunning > 0) {
    const dateStr = timeAgo.format(mostRecentStartDate);
    text = `${numRunning}/${desired_count} tasks running since ${dateStr}`;
  }
  else {
    text = `0/${desired_count} tasks running`;
  }
  return (
    <span>
      {serviceIcon}
      <span className="service-name">{humanServiceName}</span>
      &mdash; {text}
      <ServiceEventsModal service={service} />
    </span>
  );
};


/**
 * ServiceStatus - A section describing the status of the services of the system.
 */
const ServiceStatusFn = (props) => {
  const services = props.serviceStatus.get('services') || List();
  return (
    <div>
      <h2>Service Status</h2>
      <Loading isLoading={() => !props.serviceStatus.get('services')}>
        <ul className="service-stats-list">
          {
            services.map(service =>
              <li key={service.get('service_name')}><SingleServiceStatus service={service} /></li>
            )
          }
        </ul>
      </Loading>
    </div>
  );
};

/**
 * @returns The properties to send to the ServiceStatus component
 */
const serviceStatusStateToProps = ({ config, serviceStatus }) => ({ config, serviceStatus });

/**
 * Handles the service status component being mounted to cause a fetch for service status.
 */
const serviceStatusMount = ({ config, dispatch }) => ss.fetchServiceStatus(config, dispatch);

const ServiceStatus = connect(serviceStatusStateToProps)(
  // Adds in the serviceStatusMount as a callback when the ServiceStatus is mounted in React.
  functional(ServiceStatusFn, { componentWillMount: serviceStatusMount }));

module.exports = { ServiceStatus };
