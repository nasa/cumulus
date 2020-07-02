'use strict';

module.exports = {
  extends: '../../nyc.config.js',
  exclude: [
    'src',
    'tests'
  ],
  'exclude-after-remap': false
};
