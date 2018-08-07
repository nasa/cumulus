'use strict';

const fs = require('fs-extra');
const yaml = require('js-yaml');

const {
  get,
  unset
} = require('lodash');


/**
 * Load workflows yml file
 *
 * @param {string} workflowConfigFile - workflow yml file
 * @returns {Object} - JS Object representation of yml file
 */
function loadWorkflowConfigFile(workflowConfigFile) {
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

/**
 * Remove a workflow from the workflows config file and save the file
 *
 * @param {string} workflowName - workflow to remove
 * @param {string} workflowConfigFile - workflow config file
 * @returns {undefined} none
 */
function removeWorkflow(workflowName, workflowConfigFile) {
  const config = loadWorkflowConfigFile(workflowConfigFile);

  delete config[workflowName];

  saveWorkflowConfig(config, workflowConfigFile);
}

/**
 * Remove a task from the workflow and save the workflow config file. Change any
 * tasks pointing to the removed task as the 'Next' step to point to the
 * following step, or remove the 'Next' step if the removed step was the last step
 *
 * @param {*} workflowName - name of the workflow to remove the task from
 * @param {*} taskName - task name to remove
 * @param {*} workflowConfigFile - workflow config file
 * @returns {undefined} none
 */
function removeTaskFromWorkflow(workflowName, taskName, workflowConfigFile) {
  const config = loadWorkflowConfigFile(workflowConfigFile);

  unset(config, `${workflowName}.States.${taskName}`);

  const workflowConfig = get(config, workflowName);

  const tasks = Object.keys(workflowConfig.States);

  // Fix the 'Next' task configuration to skip the removed task
  tasks.forEach((task, index) => {
    if (workflowConfig.States[task].Next === taskName) {
      if (index < tasks.length - 1) {
        workflowConfig.States[task].Next = tasks[index + 1];
      }
      else {
        delete workflowConfig.States[task].Next;
      }
    }
  });

  saveWorkflowConfig(config, workflowConfigFile);
}

module.exports = {
  getWorkflowConfig,
  removeWorkflow,
  removeTaskFromWorkflow
};
