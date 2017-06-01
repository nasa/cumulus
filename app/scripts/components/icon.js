'use strict';

const React = require('react');


/**
 * Creates an icon. Specify additional classes through the className properties
 */
const Icon = props =>
  <i className={`icon fa ${props.className}`} aria-hidden="true" />;

const SuccessIcon = () => <Icon className="fa-check-circle icon-success" />;
const ErrorIcon = () => <Icon className="fa-exclamation-triangle icon-alert" />;

module.exports = {
  Icon,
  SuccessIcon,
  ErrorIcon
};
