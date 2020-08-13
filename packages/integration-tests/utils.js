'use strict';

const { readJsonFile } = require('@cumulus/common/FileUtils');
const path = require('path');
const fs = require('fs-extra');

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
  return Promise.all(absoluteFiles.map(readJsonFile));
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
  process.env.CollectionsTable = `${stackName}-CollectionsTable`;
  process.env.ProvidersTable = `${stackName}-ProvidersTable`;
  process.env.RulesTable = `${stackName}-RulesTable`;
};

module.exports = {
  readJsonFilesFromDir,
  setProcessEnvironment,
};
