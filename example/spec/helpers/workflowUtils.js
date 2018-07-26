'use strict';

const fs = require('fs');
const yaml = require('js-yaml');

/**
 * Load workflows yml file
 * 
 * @param {string} workflowConfigFile - workflow yml file,defaults to './workflows.yml'
 * @returns {Object} - JS Object representation of yml file
 */
function loadWorkflowConfigFile(workflowConfigFile = './workflows.yml') {
  return yaml.safeLoad(fs.readFileSync(workflowConfigFile, 'utf8'));
}

/**
 * Convery workflow config JS to yml 
 *
 * @param {Object} configJs - configuration as a JS object
 * @param {string} fileName - file name to save to
 * @returns {undefined} None
 */
function saveWorkflowConfig(configJs, fileName) {
  const configYaml = yaml.safeDump(configJs);
  fs.writeFileSync(fileName, configYaml);
}

/**
 * Returns workflow configuration for all workflows (default) or the workflow specifed
 *
 * @param {string} workflowConfigFile - workflow file name
 * @param {string} workflowName - workflow name
 * @returns {Object} return the workflow configuration
 */
function getWorkflowConfig(workflowConfigFile, workflowName) {
  const config = loadWorkflowConfigFile(workflowConfigFile);
  if (workflowName) return config[workflowName];
  return config;
}

module.exports = {
  getWorkflowConfig
};
