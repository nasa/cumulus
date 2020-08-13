'use strict';

const isString = require('lodash/isString');
const isNumber = require('lodash/isNumber');

/**
 * convert log level from string to number or number to string
 *
 * @param {string/number} level - log level in string or number
 * @returns {number/string} - level in number or string
 */
function convertLogLevel(level) {
  const mapping = {
    fatal: 60,
    error: 50,
    warn: 40,
    info: 30,
    debug: 20,
    trace: 10,
  };
  if (isString(level)) return mapping[level];
  if (isNumber(level)) return Object.keys(mapping).find((key) => mapping[key] === level);
  return undefined;
}

module.exports = { convertLogLevel };
