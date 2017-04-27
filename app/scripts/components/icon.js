'use strict';

const React = require('react');


/**
 * Creates an icon. Specify additional classes through the className properties
 */
const Icon = props =>
  <i className={`icon fa ${props.className}`} aria-hidden="true" />;

module.exports = Icon;
