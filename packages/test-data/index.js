'use strict';

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);

const testDataPath = (name) => path.join(__dirname, name);

/**
 * Read test data in as a string
 *
 * @param {string} name - the path to the test data
 * @returns {Promise<string>} the test data as a string
 */
const loadTestData = (name) => {
  const filePath = testDataPath(name);
  return readFile(filePath, 'utf8');
};

/**
 * Read and parse JSON-formatted test data
 *
 * @param {string} name - the path to the test data
 * @returns {Promise} the test data parsed into Javascript
 */
const loadJSONTestData = (name) => loadTestData(name).then(JSON.parse);

/**
 * Get a stream containing test data
 *
 * @param {string} name - the path to the test data
 * @returns {Stream} the test data as a writable stream
 */
const streamTestData = (name) => {
  const filePath = testDataPath(name);
  return fs.createReadStream(filePath);
};

module.exports = {
  loadJSONTestData,
  loadTestData,
  streamTestData,
};
