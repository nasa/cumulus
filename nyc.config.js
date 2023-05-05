'use strict';

const path = require('path');
module.exports = {
  all: true,
  clean: process.env.NYC_CLEAN !== 'true',
  silent: process.env.NYC_SILENT === 'true',
  'cache-dir': path.join(__dirname, 'node_modules', '.cache', 'nyc'),
  "check-coverage": process.env.FAIL_ON_COVERAGE == undefined || process.env.FAIL_ON_COVERAGE == "true"
}
