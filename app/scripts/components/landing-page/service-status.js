const React = require('react');
const { connect } = require('react-redux');
const functional = require('react-functional');
const { SuccessIcon, ErrorIcon } = require('../icon');
const util = require('../../util');
const { Loading } = require('../loading');
const { List, Map } = require('immutable');
const ss = require('../../reducers/service-status');
const { Modal, ModalButton, ModalContent } = require('../modal');


const serviceNameToHumanName = Map({
  GenerateMrf: 'MRF Generator',
  SfnScheduler: 'Scheduler',
  OnEarth: 'OnEarth'
});

/* eslint-disable camelcase */

/**
 * Returns an array of JSX elements displaying each service event.
 */
const getCombinedServiceEvents = ({ events }) =>
  events.map(({ date, message, id }) => {
    const localDate = new Date(Date.parse(date)).toLocaleString();
    // Separate paragraph elements let us put spacing between each line. Long lines are wrapped and
    // extra spacing makes this more readable.
    return <p key={id}>{`${localDate} - ${message}`}</p>;
  });

/**
 * Returns the button and modal div for displaying service events.
 */
const ServiceEventsModal = ({ service }) => {
  const serviceName = service.get('service_name');
  const humanServiceName = serviceNameToHumanName.get(serviceName);
  return (
    <Modal modalType="serviceEvents" uniqId={serviceName}>
      <ModalButton className="eui-btn--sm">View Events</ModalButton>
      <ModalContent className="wide-modal">
        <h2>{humanServiceName} Events</h2>
        <div className="eui-info-box modal-pre">{getCombinedServiceEvents(service)}</div>
      </ModalContent>
    </Modal>
  );
};

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
    const dateStr = util.humanTimeSince(mostRecentStartDate);
    text = `${numRunning}/${desired_count} tasks running since ${dateStr}`;
  }
  else {
    text = `0/${desired_count} tasks running`;
  }
  return (
    <div>
      {serviceIcon}
      <span className="service-name">{humanServiceName}</span>
      <ServiceEventsModal service={service} />
      <p className="service-status-desc">{text}</p>
    </div>
  );
};


/**
 * Displays a list of the number of connections in use for each provider. Takes a map of providers
 * to counts of connections used.
 */
const ConnectionsUsed = ({ connections }) =>
  <div>
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
  </div>;

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
          <ConnectionsUsed connections={connections} />
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
