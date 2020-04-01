'use strict';

const fs = require('fs');
const { promisify } = require('util');
const { deprecate } = require('./util');

const readFile = promisify(fs.readFile);

const readTextFile = (filename) => readFile(filename, 'utf8');

const readJsonFile = (filename) => {
  deprecate('@cumulus/common/FileUtils.readJsonFile', '1.21.0', 'fs-extra.readJson');
  return readTextFile(filename).then(JSON.parse);
};

module.exports = {
  readJsonFile,
  readTextFile
};
