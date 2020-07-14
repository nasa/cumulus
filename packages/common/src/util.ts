/**
 * Simple utility functions
 * @module util
 *
 * @example
 * const { isNil } = require('@cumulus/common/util');
 *
 * isNil(undefined); // => true
 */

import curry from 'lodash/curry';
import flow from 'lodash/flow';
import fs from 'fs';
import mime from 'mime-types';
import omitBy from 'lodash/omitBy';
import os from 'os';
import path from 'path';
import * as log from './log';

/**
 * Mark a piece of code as deprecated.
 *
 * Each deprecation notice for a given name and version combination will
 * only be printed once.
 *
 * @param {string} name - the name of the function / method / class to deprecate
 * @param {string} version - the version after which the code will be marked
 *   as deprecated
 * @param {string} [alternative] - the function / method / class to use instead
 *   of this deprecated code
 *
 * @alias module:util
 */
export const deprecate = (() => {
  const warned = new Set();

  return (name: string, version: string, alternative?: string) => {
    const key = `${name}-${version}`;
    if (warned.has(key)) return;

    warned.add(key);
    let message = `${name} is deprecated after version ${version} and will be removed in a future release.`;
    if (alternative) message += ` Use ${alternative} instead.`;
    log.warn(message);
  };
})();

/**
 * Wait for the defined number of milliseconds
 *
 * @param {number} waitPeriodMs - number of milliseconds to wait
 * @returns {Promise.<undefined>} promise resolves after a given time period
 *
 * @deprecated
 *
 * @alias module:util
 */
export const sleep = (waitPeriodMs: number) => {
  deprecate('@cumulus/common/util.sleep', '1.23.2', 'delay');

  return (new Promise((resolve) =>
    setTimeout(resolve, waitPeriodMs)));
};

/**
 * Synchronously makes a temporary directory, smoothing over the differences between
 * mkdtempSync in node.js for various platforms and versions
 *
 * @param {string} name - A base name for the temp dir, to be uniquified for the final name
 * @returns {string} The absolute path to the created dir
 *
 * @private
 *
 * @deprecated
 */
export const mkdtempSync = (name: string) => {
  deprecate('@cumulus/common/util.mkdtempSync()', '1.23.2');
  const dirname = ['gitc', name, +new Date()].join('_');
  const abspath = path.join(os.tmpdir(), dirname);
  fs.mkdirSync(abspath, 0o700);
  return abspath;
};

/**
 * Does nothing.  Used where a callback is required but not used.
 *
 * @returns {undefined} undefined
 *
 * @alias module:util
 *
 * @deprecated
 */
export const noop = () => {
  deprecate('@cumulus/common/util.noop()', '1.23.2', 'lodash/noop');
};

/**
 * Replacement for lodash.omit returns a shallow copy of input object
 * with keys removed.
 * (lodash.omit will be removed in v5.0.0)
 * https://github.com/lodash/lodash/wiki/Roadmap#v500-2019
 *
 * @param {Object} objectIn - input object
 * @param {(string|string[])} keys - key or list of keys to remove from object
 * @returns {Object} copy of objectIn without keys attached.
 *
 * @alias module:util
 *
 * @deprecated
 */
// @ts-ignore
export const omit = (objectIn, keys) => {
  deprecate('@cumulus/common/util.omit()', '1.23.2', 'lodash/omit');
  const keysToRemove = [].concat(keys);
  const objectOut = { ...objectIn };
  keysToRemove.forEach((key) => delete objectOut[key]);
  return objectOut;
};

/**
 * Creates a function that returns the opposite of the predicate function.
 *
 * @param {Function} predicate - the predicate to negate
 * @returns {Function} the new negated function
 *
 * @alias module:util
 *
 * @deprecated
 *
 * @example
 * const isEven = (x) => x % 2 === 0;
 * const isOdd = negate(isEven);
 *
 * isOdd(2); // => false
 * isOdd(3); // => true
 */
export const negate = <T extends (...args: any[]) => boolean>(predicate: T) => {
  deprecate('@cumulus/common/util.negate()', '1.23.2');

  return (...args: Parameters<typeof predicate>) => !predicate(...args);
};

/**
 * Test if a value is null
 *
 * @param {*} x - value to check
 * @returns {boolean}
 *
 * @deprecated
 *
 * @alias module:util
 */
export const isNull = (x: unknown) => {
  deprecate('@cumulus/common/util.isNull()', '1.23.2', 'lodash/isNull');
  return x === null;
};

/**
 * Test if a value is undefined
 *
 * @param {*} x value to check
 * @returns {boolean}
 *
 * @deprecated
 *
 * @alias module:util
 */
export const isUndefined = (x: unknown) => {
  deprecate('@cumulus/common/util.isUndefined()', '1.23.2', 'lodash/isUndefined');
  return x === undefined;
};

/**
 * Test if a value is null or undefined
 *
 * @param {*} x value to check
 * @returns {boolean}
 *
 * @deprecated
 *
 * @alias module:util
 */
export const isNil = (x: unknown) => {
  deprecate('@cumulus/common/util.isNil()', '1.23.2', 'lodash/isNil');
  return isNull(x) || isUndefined(x);
};

/**
 * Rename an object property
 *
 * @param {string} from - old property name
 * @param {string} to - new property name
 * @param {Object} obj - object to update
 * @returns {Object} a shallow clone of the object with updated property name
 *
 * @deprecated
 *
 * @alias module:util
 */
export const renameProperty = <T>(from: keyof T, to: string, obj: T) => {
  deprecate('@cumulus/common/util.renameProperty()', '1.23.2');
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
 *
 * @alias module:util
 */
export const removeNilProperties = <T extends object>(obj: T) =>
  omitBy(obj, isNil);

/**
 * Return mime-type based on input url or filename
 *
 * @param {string} key
 * @returns {string} mimeType or null
 *
 * @deprecated
 *
 * @alias module:util
 */
export const lookupMimeType = (key: string) => {
  deprecate('@cumulus/common/util.lookupMimeType()', '1.23.2');
  // eslint-disable-next-line unicorn/no-null
  return mime.lookup(key) || null;
};

/**
 * Test if a value is included in a list of items
 *
 * This is a curried function - https://lodash.com/docs/4.17.11#curry
 *
 * @param {Array} collection - the list of items to check against
 * @param {Object} val - the item to check for in the collection
 * @returns {boolean}
 *
 * @alias module:util
 * @kind function
 */
export const isOneOf = curry(
  (collection: unknown[], val: unknown) => collection.includes(val),
  2
);

/**
 * Pass a value through a pipeline of functions and return the result
 *
 * @param {*} value - the value to be passed through the pipeline of functions
 * @param {...Function} fns - the functions to be invoked
 * @returns {*} the result of passing the value through the functions:
 *   - If no functions are provided, the value is returned.
 *   - Functions should expect a single argument
 *
 * @deprecated
 *
 * @alias module:util
 */
// @ts-ignore
export const thread = (value, ...fns) => {
  deprecate('@cumulus/common/util.thread()', '1.23.2');
  return flow(fns)(value);
};
