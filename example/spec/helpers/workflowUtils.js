'use strict';

const unset = require('lodash.unset');

const { loadYmlConfigFile, saveYmlConfigFile } = require('./configUtils.js');


/**
 * Remove a workflow from the workflows config file and save the file
 *
 * @param {string} workflowName - workflow to remove
 * @param {string} workflowConfigFile - workflow config file
 * @returns {undefined} none
 */
function removeWorkflow(workflowName, workflowConfigFile) {
  const config = loadYmlConfigFile(workflowConfigFile);

  delete config[workflowName];

  saveYmlConfigFile(config, workflowConfigFile);
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
  const config = loadYmlConfigFile(workflowConfigFile);

  unset(config, `${workflowName}.States.${taskName}`);

  const workflowConfig = config[workflowName];

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

  saveYmlConfigFile(config, workflowConfigFile);
}

module.exports = {
  removeWorkflow,
  removeTaskFromWorkflow
};
