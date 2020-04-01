'use strict';

const fs = require('fs-extra');
const path = require('path');

const testDataPath = (name) => path.join(__dirname, name);

/**
 * Read and parse JSON-formatted test data
 *
 * @param {string} name - the path to the test data
 * @returns {Promise} the test data parsed into Javascript
 */
const loadJSONTestData = (name) => fs.readJson(testDataPath(name));

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
  streamTestData
};
