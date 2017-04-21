'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 *
 */
exports.mkdtempSync = (name) => {
  if (fs.mkdtempSync) {
    return fs.mkdtempSync(`gitc_${name}`);
  }
  const dirname = ['gitc', name, +new Date()].join('_');
  const abspath = path.join(os.tmpdir(), dirname);
  fs.mkdirSync(abspath, 0o700);
  return abspath;
};
