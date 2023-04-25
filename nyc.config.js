'use strict';

const path = require('path');

module.exports = {
  all: true,
  clean: process.env.NYC_CLEAN !== 'true',
  silent: process.env.NYC_SILENT === 'true',
  'cache-dir': path.join(__dirname, 'node_modules', '.cache', 'nyc'),
  'temp-dir': path.join(__dirname, '.nyc_output'),
  'check-coverage': true,
  lines: 75,
  functions: 69,
  branches: 70,
  statements: 75
};
