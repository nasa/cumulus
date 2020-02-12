'use strict';

const fs = require('fs');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);

const readTextFile = (filename) => readFile(filename, 'utf8');

const readJsonFile = (filename) => readTextFile(filename).then(JSON.parse);

module.exports = {
  readJsonFile,
  readTextFile
};
