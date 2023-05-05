'use strict';

const path = require('path');

module.exports = {
  all: true,
  clean: process.env.NYC_CLEAN !== 'true',
  silent: process.env.NYC_SILENT === 'true',
  'cache-dir': path.join(__dirname, 'node_modules', '.cache', 'nyc'),
  lines: 89,
  functions: 75,
  branches: 80,
  statements: 88,
};
