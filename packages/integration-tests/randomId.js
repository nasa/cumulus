'use strict';

const cryptoRandomString = require('crypto-random-string');

module.exports = (prefix, separator = '-') =>
  `${prefix}${separator}${cryptoRandomString({ length: 6 })}`;
