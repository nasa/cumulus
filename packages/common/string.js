'use strict';

/**
 * A collection of utilities for working with URLs
 * @module string
 *
 * @example
 * const { toLower } = require('@cumulus/common/string');
 *
 * toLower('aSDf'); // => 'asdf'
 */

const compose = require('lodash.flowright');
const curry = require('lodash.curry');
const isString = require('lodash.isstring');

const { isNull, negate } = require('./util');

/**
 * Return a new string with some or all matches of a pattern replaced by a
 * replacement.
 *
 * @param {string|RegExp} pattern - if a string, this is the substring to be
 *   replaced by `replacement`. If a RegExp, any match or matches will be
 *   replaced by `replacement`.
 * @param {string|function} replacement - if a string, the value to replace
 *   `pattern` with. If a function, instances of `pattern` will be replaced with
 *   the result of calling the function.
 * @param {string} string - The string to modify
 * @returns {string} the modified string
 *
 * For additional details on the pattern and replacement arguments, see:
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace#Parameters
 *
 * This is a curried function - https://lodash.com/docs/4.17.11#curry
 *
 * @alias module:string
 * @kind function
 */
const replace = curry(
  (pattern, replacement, string) => string.replace(pattern, replacement)
);

/**
 * Globally replaces oldSubstring in string with newSubString
 *
 * @param {string} string - The string to modify
 * @param {string} oldSubString - The string to replace
 * @param {string} newSubString - The string replacement
 * @returns {string} the modified string
 *
 * @alias module:string
 */
function globalReplace(string, oldSubString, newSubString) {
  return string.replace(new RegExp(oldSubString, 'g'), newSubString);
}

/**
 * Converts string, as a whole, to lower case just like String#toLowerCase
 *
 * @param {string} str - the string to convert
 * @returns {string} the lower-cased string
 *
 * @alias module:string
 */
const toLower = (str) => str.toLowerCase();

/**
 * Converts string, as a whole, to upper case just like String#toUpperCase
 *
 * @param {string} str - the string to convert
 * @returns {string} the upper-cased string
 *
 * @alias module:string
 */
const toUpper = (str) => str.toUpperCase();

/**
 * Tests a regular expression against a String, returning matches
 *
 * Produces same output as https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match
 *
 * This is a curried function - https://lodash.com/docs/4.17.11#curry
 *
 * @param {RegExp} regexp - the pattern to match against
 * @param {string} str - the string to match against
 * @returns {Array|null}
 *
 * @alias module:string
 * @kind function
 */
const match = curry((regexp, str) => str.match(regexp), 2);

/**
 * Tests a regular expression against a string, returning true / false
 *
 * This is a curried function - https://lodash.com/docs/4.17.11#curry
 *
 * @param {RegExp} regexp - the pattern to match against
 * @param {string} str - the string to match against
 * @returns {boolean} true if the pattern matches the string, false otherwise
 *
 * @alias module:string
 * @kind function
 *
 * @example
 * const isCapitalized = matches(/^[A-Z]/);
 * isCapitalized('Joe'); // => true
 */
const matches = curry(
  compose([negate(isNull), match]), 2
);

// This regex is not perfect, but it's sufficient for our purposes.
const hostnameRegex = /^[a-z0-9][a-z0-9\.\-]*$/;

/**
 * Test if a string is a valid hostname, as defined by {@link https://tools.ietf.org/html/rfc1123#page-13 RFC1123}
 *
 * @param {String} hostname - the string to test
 * @returns {boolean}
 *
 * @alias module:string
 * @kind function
 *
 * @example
 * isValidHostname('example.com'); // => true
 * isValidHostname('as!@#'); // => false
 * isValidHostname('127.0.0.1'); // => false
 */
const isValidHostname = compose(matches(hostnameRegex), toLower);

/**
 * Test if a value is a string with a length greater than zero
 *
 * @param {string} x - the string to test
 * @returns {boolean}
 *
 * @alias module:string
 */
const isNonEmptyString = (x) => isString(x) && x.length > 0;

module.exports = {
  globalReplace,
  isNonEmptyString,
  isValidHostname,
  match,
  matches,
  replace,
  toLower,
  toUpper
};
