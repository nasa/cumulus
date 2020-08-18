'use strict';

module.exports = {
  extends: '../../nyc.config.js',
  include: [
    '*.js',
    'api',
    'bin',
    'lambdas',
  ],
};
