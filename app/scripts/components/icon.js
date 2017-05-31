'use strict';

const React = require('react');


/**
 * Creates an icon. Specify additional classes through the className properties
 */
const Icon = props =>
  <i className={`icon fa ${props.className}`} aria-hidden="true" />;

const SuccessIcon = () => <Icon className="fa-check-circle icon-success" />;
const ErrorIcon = () => <Icon className="fa-exclamation-triangle icon-alert" />;

const RunningPill = () =>
  <span className="pill running-pill">
    <Icon className="fa-repeat" />
    Running
  </span>;

const SuccessPill = () =>
  <span className="pill success-pill">
    <Icon className="fa-check" />
    Success
  </span>;

const FailedPill = () =>
  <span className="pill failed-pill">
    <Icon className="fa-times" />
    Failed
  </span>;


module.exports = {
  Icon,
  SuccessIcon,
  ErrorIcon,
  RunningPill,
  SuccessPill,
  FailedPill
};
