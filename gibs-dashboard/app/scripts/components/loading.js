const React = require('react');
const { Icon, ClickableIcon } = require('./icon');

const RefreshingIcon = () => <Icon className="fa-refresh fa-spin icon-refreshing" />;
const LoadingIcon = () => <Icon className="fa-circle-o-notch fa-spin fa-2x icon-loading" />;

/**
 * Shows a loading icon while props.isLoading. Once loading is complete the children are shown.
 */
const Loading = (props) => {
  if (props.isLoading()) {
    return <LoadingIcon />;
  }
  return props.children;
};

const RefreshButton = ({ reloading, onClick }) => {
  if (reloading) {
    return <RefreshingIcon />;
  }
  return (
    <ClickableIcon onClick={onClick} className="fa-refresh" />
  );
};

module.exports = { Loading, RefreshButton };
