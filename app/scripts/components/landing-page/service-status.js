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
const getCombinedServiceEvents = ({ events }) =>
  events.map(({ date, message, id }) => {
    const localDate = new Date(Date.parse(date)).toLocaleString();
    return <p key={id}>{`${localDate} - ${message}`}</p>;
  });

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
        <div className="eui-info-box modal-pre">{getCombinedServiceEvents(service)}</div>
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
  const connections = props.serviceStatus.get('connections') || Map();
  return (
    <div>
      <h2>Service Status</h2>
      <Loading isLoading={() => !props.serviceStatus.get('services')}>
        <div>
          <ul className="service-stats-list">
            {
              services.map(service =>
                <li key={service.get('service_name')}><SingleServiceStatus service={service} /></li>
              )
            }
          </ul>
          <h3>Connections In Use</h3>
          <ul className="connections-used-list">
            {
              connections.keySeq().map((provider) => {
                const { connection_limit, used } = connections.get(provider);
                const limitDesc = connection_limit === 'unlimited' ?
                  connection_limit :
                  `${used}/${connection_limit}`;
                return (
                  <li key={provider}>
                    {provider} &mdash; {limitDesc}
                  </li>
                );
              })
            }
          </ul>
        </div>
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
