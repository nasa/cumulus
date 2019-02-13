'use strict';

const fs = require('fs');
const isNil = require('lodash.isnil');
const omitBy = require('lodash.omitby');
const os = require('os');
const path = require('path');
const log = require('./log');

/**
 * Mark a piece of code as deprecated
 *
 * @param {string} name - the name of the function / method / class to deprecate
 * @param {string} version - the version after which the code will be marked
 *   as deprecated
 * @param {string} [alternative] - the function / method / class to use instead
 *   of this deprecated code
 */
exports.deprecate = (name, version, alternative) => {
  let message = `${name} is deprecated after version ${version} and will be removed in a future release.`;
  if (alternative) message += ` Use ${alternative} instead.`;

  log.warn(message);
};

/**
 * Wait for the defined number of milliseconds
 *
 * @param {number} waitPeriodMs - number of milliseconds to wait
 * @returns {Promise.<undefined>} - promise resolves after a given time period
 */
exports.sleep = (waitPeriodMs) =>
  (new Promise((resolve) =>
    setTimeout(resolve, waitPeriodMs)));

/**
 * Synchronously makes a temporary directory, smoothing over the differences between
 * mkdtempSync in node.js for various platforms and versions
 *
 * @param {string} name - A base name for the temp dir, to be uniquified for the final name
 * @returns {string} - The absolute path to the created dir
 */
exports.mkdtempSync = (name) => {
  const dirname = ['gitc', name, +new Date()].join('_');
  const abspath = path.join(os.tmpdir(), dirname);
  fs.mkdirSync(abspath, 0o700);
  return abspath;
};

/**
 * Generate and return an RFC4122 v4 UUID.
 * @return - An RFC44122 v4 UUID.
 */
exports.uuid = require('uuid/v4');

/**
 * Does nothing.  Used where a callback is required but not used.
 *
 * @returns {undefined} undefined
 */
exports.noop = () => {}; // eslint-disable-line lodash/prefer-noop

/**
 * Replacement for lodash.omit returns a shallow copy of input object
 * with keys removed.
 * (lodash.omit will be removed in v5.0.0)
 * https://github.com/lodash/lodash/wiki/Roadmap#v500-2019
 *
 * @param {Object} objectIn - input object
 * @param {(string|string[])} keys - key or list of keys to remove from object
 * @returns {Object} copy of objectIn without keys attached.
 */
exports.omit = (objectIn, keys) => {
  const keysToRemove = [].concat(keys);
  const objectOut = { ...objectIn };
  keysToRemove.forEach((key) => delete objectOut[key]);
  return objectOut;
};

/**
 * Update the stack of an error
 *
 * @param {Error} error - an Error
 * @param {string} stack - a stack trace
 */
exports.setErrorStack = (error, stack) => {
  // eslint-disable-next-line no-param-reassign
  error.stack = [
    error.stack.split('\n')[0],
    ...stack.split('\n').slice(1)
  ].join('\n');
};

exports.renameProperty = (from, to, obj) => {
  const newObj = { ...obj, [to]: obj[from] };
  delete newObj[from];
  return newObj;
};

exports.removeNilProperties = (obj) => omitBy(obj, isNil);
