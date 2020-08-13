'use strict';

module.exports = {
  extends: '../../nyc.config.js',
  include: [
    '*.js',
    'app',
    'bin',
    'endpoints',
    'es',
    'lambdas',
    'lib',
    'migrations',
    'models',
  ],
};
