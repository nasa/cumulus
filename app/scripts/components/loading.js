const React = require('react');
const { Icon } = require('./icon');

/**
 * Shows a loading icon while props.isLoading. Once loading is complete the children are shown.
 */
const Loading = (props) => {
  if (props.isLoading()) {
    return <Icon className="fa-circle-o-notch fa-spin fa-2x fa-fw" />;
  }
  return props.children;
};

module.exports = { Loading };
