'use strict';

module.exports = {
  extends: '../../nyc.config.js',
  include: ['dist/src'],
  'exclude-after-remap': false,
};
