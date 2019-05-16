'use strict';

const curry = require('lodash.curry');

const filter = curry((predicate, coll) => coll.filter(predicate));

const map = curry((fn, coll) => coll.map(fn));

const negate = (fn) => (...args) => !fn(...args);

// eslint-disable-next-line lodash/prefer-is-nil
const isNil = (x) => x === undefined || x === null;
const isNotNil = negate(isNil);

const splitLines = (x) => x.split('\n');

const trim = (x) => x.trim();

module.exports = {
  filter,
  negate,
  isNil,
  isNotNil,
  map,
  splitLines,
  trim
};
