'use strict';

const fs = require('fs-extra');
const yaml = require('js-yaml');
const { loadYmlFile } = require('./testUtils');
const { assignIn } = require('lodash.assignin');

/**
 * Load a configuration yml file
 *
 * @param {string} filePath - workflow yml filepath
 * @returns {Object} - JS Object representation of yml file
 */
function loadYmlConfigFile(filePath) {
  return loadYmlFile(filePath);
}

/**
 * Convert config JS to yml
 *
 * @param {Object} configJs - configuration as a JS object
 * @param {string} filepath - file path to save to
 * @returns {undefined} None
 */
function saveYmlConfigFile(configJs, filepath) {
  const configYaml = yaml.safeDump(configJs);
  fs.writeFileSync(filepath, configYaml);
}

/**
 * Returns configuration object for entire configuration yml, or the top-level node
 * specified
 *
 * @param {string} configFilepath -config file path
 * @param {string} nodeName - workflow name
 * @returns {Object} return the workflow configuration
 */
function getConfigObject(configFilepath, nodeName) {
  const config = loadYmlConfigFile(configFilepath);
  if (nodeName) return config[nodeName];
  return config;
}

/**
 * Updates configuration file node with values specified in configJson*
 * @param {string} configFilePath -config file path
 * @param {string} nodeName - top-level-node name
 * @param {Object} configJson - JSON object to append/overwrite target key's values with
 * @returns {Object} return the workflow configuration
 */

function updateConfigObject(configFilePath, nodeName, configJson) {
  const config = loadYmlConfigFile(configFilePath);
  assignIn(config[nodeName], configJson);
  saveYmlConfigFile(config, configFilePath);
}

module.exports = {
  getConfigObject,
  loadYmlFile,
  saveYmlConfigFile,
  updateConfigObject
};
