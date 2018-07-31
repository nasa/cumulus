'use strict';

const fs = require('fs-extra');
const yaml = require('js-yaml');

const {
  get,
  omit,
  unset
} = require('lodash');

const workflowsYmFile = './workflows.yml';
const workflowsYmlCopyFile = './workflowsCopy.yml';

/**
 * Copy the workflows.yml file to a backup location
 *
 * @returns {undefined} none
 */
function backupWorkflowsYml() {
  fs.copyFileSync(workflowsYmFile, workflowsYmlCopyFile);
}

/**
 * Copy the workflows.yml back from the backup location. Delete
 * the backup workflows file
 *
 * @returns {undefined} none
 */
function restoreWorkflowsYml() {
  fs.copyFileSync(workflowsYmlCopyFile, workflowsYmFile);
  fs.unlinkSync(workflowsYmlCopyFile);
}

/**
 * Load workflows yml file
 *
 * @param {string} workflowConfigFile - workflow yml file,defaults to './workflows.yml'
 * @returns {Object} - JS Object representation of yml file
 */
function loadWorkflowConfigFile(workflowConfigFile = workflowsYmFile) {
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
 * @param {string} workflowConfigFile - workflow config file, defaults to
 * workflows.yml
 * @returns {undefined} none
 */
function removeWorkflow(workflowName, workflowConfigFile = workflowsYmFile) {
  let config = loadWorkflowConfigFile(workflowConfigFile);

  config = omit(config, workflowName);

  saveWorkflowConfig(config, workflowConfigFile);
}

/**
 * Remove a task from the workflow and save the workflow config file. Change any
 * tasks pointing to the removed task as the 'Next' step to point to the
 * following step, or remove the 'Next' step if the removed step was the last step
 *
 * @param {*} workflowName - name of the workflow to remove the task from
 * @param {*} taskName - task name to remove
 * @param {*} workflowConfigFile - workflow config file, defaults to workflows.yml
 * @returns {undefined} none
 */
function removeTaskFromWorkflow(workflowName, taskName, workflowConfigFile = workflowsYmFile) {
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
  backupWorkflowsYml,
  restoreWorkflowsYml,
  removeWorkflow,
  removeTaskFromWorkflow
};
