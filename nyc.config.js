'use strict';

const path = require('path');

module.exports = {
  all: true,
  'no-clean': true,
  silent: process.env.NYC_SILENT === 'true',
  'temp-dir': path.join(__dirname, '.nyc_output'),
  include: [
    '**',
    '!**/coverage/**',
    '!nyc.config.js'
  ]
};
