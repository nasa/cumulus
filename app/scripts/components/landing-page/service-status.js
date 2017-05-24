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

/**
 * Shows the status of a single service.
 */
const SingleServiceStatus = ({ service }) => {
  const { desired_count, service_name, running_tasks } = service;
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
      <span className="service-name">
        {serviceNameToHumanName.get(service_name)}
      </span> &mdash; {text}
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
