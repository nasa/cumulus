'use strict';

/**
 * Simple utility functions
 * @module
 *
 * @example
 * const { isNil } = require('@cumulus/common/util');
 *
 * isNil(undefined); // => true
 */

const fs = require('fs');
const isNil = require('lodash.isnil');
const omitBy = require('lodash.omitby');
const os = require('os');
const path = require('path');
const mime = require('mime-types');
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
 * @returns {Promise.<undefined>} promise resolves after a given time period
 */
exports.sleep = (waitPeriodMs) =>
  (new Promise((resolve) =>
    setTimeout(resolve, waitPeriodMs)));

/**
 * Synchronously makes a temporary directory, smoothing over the differences between
 * mkdtempSync in node.js for various platforms and versions
 *
 * @param {string} name - A base name for the temp dir, to be uniquified for the final name
 * @returns {string} The absolute path to the created dir
 * @private
 */
exports.mkdtempSync = (name) => {
  const dirname = ['gitc', name, +new Date()].join('_');
  const abspath = path.join(os.tmpdir(), dirname);
  fs.mkdirSync(abspath, 0o700);
  return abspath;
};

/**
 * Generate and return an RFC4122 v4 UUID.
 *
 * @return {string} An RFC44122 v4 UUID.
 * @kind function
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

/*
 * Creates a function that returns the opposite of the predicate function.
 *
 * @param {Function} predicate - the predicate to negate
 * @returns {Function} the new negated function
 * @kind function
 *
 * @example
 * const isEven = (x) => x % 2 === 0;
 * const isOdd = negate(isEven);
 *
 * isOdd(2); // => false
 * isOdd(3); // => true
 */
exports.negate = (predicate) => (...args) => !predicate.apply(this, args);

/**
 * Test if a value is null
 *
 * @param {*} x value to check
 * @returns {boolean}
 */
exports.isNull = (x) => x === null;

/**
 * Test if a value is undefined
 *
 * @param {*} x value to check
 * @returns {boolean}
 */
exports.isUndefined = (x) => x === undefined;

/**
 * Test if a value is null or undefined
 *
 * @param {*} x value to check
 * @returns {boolean}
 */
exports.isNil = (x) => exports.isNull(x) || exports.isUndefined(x);

/**
 * Replace the stack of an error
 *
 * Note: This mutates the error that was passed in.
 *
 * @param {Error} error - an Error
 * @param {string} newStack - a stack trace
 */
exports.setErrorStack = (error, newStack) => {
  // eslint-disable-next-line no-param-reassign
  error.stack = [
    error.stack.split('\n')[0],
    ...newStack.split('\n').slice(1)
  ].join('\n');
};

/**
 * Rename an object property
 *
 * @param {string} from - old property name
 * @param {string} to - new property name
 * @param {Object} obj - object to update
 * @returns {Object} a shallow clone of the object with updated property name
 */
exports.renameProperty = (from, to, obj) => {
  const newObj = { ...obj, [to]: obj[from] };
  delete newObj[from];
  return newObj;
};

/**
 * Remove properties whose values are `null` or `undefined`
 *
 * @param {Object} obj - object to update
 * @returns {Object} a shallow clone of the object with `null` and `undefined`
 *   properties removed
 */
exports.removeNilProperties = (obj) => omitBy(obj, isNil);

/**
 * Return mime-type based on input url or filename
 *
 * @param {string} key
 * @returns {string} mimeType or null
 */
exports.lookupMimeType = (key) => mime.lookup(key) || null;
