'use strict';

const { readJsonFile } = require('@cumulus/common/FileUtils');
const path = require('path');
const fs = require('fs-extra');

/**
* Returns string appended with _[0-9,a-z] up to 36 batches)
* @param {string} basePath - Directory base path
* @param {number} count - Number of paths to return
* @returns {[string]} - Array of directory names
*/
const generateIterableTestDirectories = (basePath, count) => {
  if (count > 36) {
    throw new Error('Predefined directory pattern only defined up to 36 batches');
  }
  // Array containing 0-9, a-z
  const sourceKeys = [...new Array(9).keys()].concat(
    [...new Array(26).keys()].map((i) => String.fromCharCode(i + 97))
  );
  return sourceKeys.slice(0, count).map((i) => `${basePath}_${i}`);
};

/**
 * Load and parse all of the JSON files from a directory
 *
 * @param {string} sourceDir - the directory containing the JSON files to load
 * @returns {Promise<Array<*>>} the parsed JSON files
 */
const readJsonFilesFromDir = async (sourceDir) => {
  const allFiles = await fs.readdir(sourceDir);
  const jsonFiles = allFiles.filter((f) => f.endsWith('.json'));
  const absoluteFiles = jsonFiles.map((f) => path.join(sourceDir, f));
  return await Promise.all(absoluteFiles.map(readJsonFile));
};

/**
 * set process environment necessary for database transactions
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 */
const setProcessEnvironment = (stackName, bucketName) => {
  process.env.system_bucket = bucketName;
  process.env.stackName = stackName;
  process.env.messageConsumer = `${stackName}-messageConsumer`;
  process.env.KinesisInboundEventLogger = `${stackName}-KinesisInboundEventLogger`;
};

module.exports = {
  generateIterableTestDirectories,
  readJsonFilesFromDir,
  setProcessEnvironment,
};
