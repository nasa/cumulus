'use strict';

const cryptoRandomString = require('crypto-random-string');

const randomId = (prefix, separator = '-') =>
  `${prefix}${separator}-${cryptoRandomString({ length: 6 })}`;

module.exports = {
  randomId
};
