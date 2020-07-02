'use strict';

module.exports = {
  extends: '../../nyc.config.js',
  include: ['dist'],
  'exclude-after-remap': false
};
