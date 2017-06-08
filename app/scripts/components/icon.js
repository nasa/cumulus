'use strict';

const React = require('react');


/**
 * Creates an icon. Specify additional classes through the className properties
 */
const Icon = props =>
  <i className={`icon fa ${props.className}`} aria-hidden="true" />;

const SuccessIcon = () => <Icon className="fa-check-circle icon-success" />;
const ErrorIcon = () => <Icon className="fa-exclamation-triangle icon-alert" />;

const ClickableIcon = ({ className, onClick }) =>
  <a
    role="button"
    href="/"
    className="icon-clickable"
    onClick={onClick}
  >
    <Icon className={className} />
  </a>;

module.exports = {
  Icon,
  SuccessIcon,
  ErrorIcon,
  ClickableIcon
};
