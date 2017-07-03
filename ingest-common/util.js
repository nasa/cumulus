'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Synchronously makes a temporary directory, smoothing over the differences between
 * mkdtempSync in node.js for various platforms and versions
 * @param {string} name - A base name for the temp dir, to be uniquified for the final name
 * @return - The absolute path to the created dir
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
