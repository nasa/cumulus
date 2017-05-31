
const JsTimeAgo = require('javascript-time-ago');
JsTimeAgo.locale(require('javascript-time-ago/locales/en'));
const timeAgo = new JsTimeAgo('en-US');
const fuzzyStyle = timeAgo.style.fuzzy();

// TODO write tests for these functions

/**
 * Returns how long ago in human terms a date occurred
 */
const humanTimeSince = dateInt => timeAgo.format(dateInt);

/**
 * Returns a human styled duration from the given number of milliseconds.
 */
const humanDuration = (ms) => {
  if (ms < 60000) {
    // TODO this returns fractional seconds when it should not.
    return `${ms / 1000} seconds`;
  }
  return timeAgo.format(Date.now() - ms, fuzzyStyle);
};

/**
 * Converts a date string in ISO format into a local specific date string.
 */
const dateStringToLocaleString = dateStr => new Date(Date.parse(dateStr)).toLocaleString();

module.exports = {
  dateStringToLocaleString,
  humanTimeSince,
  humanDuration
};
