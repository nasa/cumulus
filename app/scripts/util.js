
const JsTimeAgo = require('javascript-time-ago');
JsTimeAgo.locale(require('javascript-time-ago/locales/en'));
const timeAgo = new JsTimeAgo('en-US');
const fuzzyStyle = timeAgo.style.fuzzy();

/**
 * Returns how long ago in human terms a date occurred
 */
const humanTimeSince = dateInt => timeAgo.format(dateInt);

/**
 * Returns a human styled duration from the given number of milliseconds.
 */
const humanDuration = (ms) => {
  if (ms < 1000) {
    return `${ms / 1000} seconds`;
  }
  if (ms < 60000) {
    return `${Math.round(ms / 1000)} seconds`;
  }
  return timeAgo.format(Date.now() - ms, fuzzyStyle);
};

/**
 * Converts a date string in ISO format into a local specific date string.
 */
const dateStringToLocaleString = dateStr => new Date(Date.parse(dateStr)).toLocaleString();


/**
 * Takes a date and returns it in a string formatted as YYYY-MM-DD.
 */
const toDateString = (date) => {
  const zeroPad = n => (n < 10 ? `0${n}` : n);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${y}-${zeroPad(m)}-${zeroPad(d)}`;
};

// TODO rename this to parseDayOfYear. Julian is incorrect
/**
 * Parses a julian date like '2014130' and returns a string formatted date of YYYY-MM-DD
 */
const parseJulian = (dateStr) => {
  // Parse out the components of a julian date string.
  const match = dateStr.match(/^(\d\d\d\d)(\d+)$/);
  if (!match) {
    return 'Invalid date';
  }
  const [_, yearStr, dayOfYearStr] = match;
  const year = Number(yearStr);
  const dayOfYear = Number(dayOfYearStr);

  // Calculate date from Julian date
  const daysSinceJanFirst = dayOfYear - 1;
  const msSinceJanFirst = daysSinceJanFirst * 24 * 3600 * 1000;
  const yearMs = Date.UTC(year, 0);
  return toDateString(new Date(yearMs + msSinceJanFirst));
};

module.exports = {
  dateStringToLocaleString,
  humanTimeSince,
  humanDuration,
  toDateString,
  parseJulian
};
