'use strict';

const curry = require('lodash.curry');
const every = require('lodash.every');
const isArray = require('lodash.isarray');
const isString = require('lodash.isstring');

const filter = curry((predicate, coll) => coll.filter(predicate));

const map = curry((fn, coll) => coll.map(fn));

const negate = (fn) => (...args) => !fn(...args);

const isArrayOfStrings = (x) => isArray(x) && every(x, isString);

// eslint-disable-next-line lodash/prefer-is-nil
const isNil = (x) => x === undefined || x === null;

const splitLines = (x) => x.split('\n');

const trim = (x) => x.trim();

module.exports = {
  filter,
  isArray,
  isNotArray: negate(isArray),
  isArrayOfStrings,
  isNotArrayOfStrings: negate(isArrayOfStrings),
  isNil,
  isNotNil: negate(isNil),
  isString,
  isNotString: negate(isString),
  map,
  negate,
  splitLines,
  trim
};
