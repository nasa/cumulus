'use strict';

const fs = require('fs');
const yaml = require('js-yaml');


function loadWorkflowFile(workflowConfigFile = './workflows.yml') {
  return yaml.safeLoad(fs.readFileSync(workflowConfigFile, 'utf8'));
}

/**
 * Returns workflow configuration for all workflows (default) or the workflow specifed
 *
 * @param {string} workflowConfigFile - workflow file name
 * @param {string} workflowName - workflow name
 * @returns {Object} return the workflow configuration
 */
function getWorkflowConfig(workflowConfigFile, workflowName) {
  const config = loadWorkflowFile(workflowConfigFile);
  if (workflowName) return config[workflowName];
  return config;
}

module.exports = {
  getWorkflowConfig
};
