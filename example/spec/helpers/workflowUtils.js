'use strict';

const get = require('lodash.get');
const unset = require('lodash.unset');

const { loadYmlFile, saveYmlConfigFile } = require('./configUtils.js');


/**
 * Remove a workflow from the workflows config file and save the file
 *
 * @param {string} workflowName - workflow to remove
 * @param {string} workflowConfigFile - workflow config file
 * @returns {undefined} none
 */
function removeWorkflow(workflowName, workflowConfigFile) {
  const config = loadYmlFile(workflowConfigFile);

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
  const config = loadYmlFile(workflowConfigFile);

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

function isReingestExecution(taskInput) {
  return get(
    taskInput,
    'cumulus_meta.cumulus_context.reingestGranule',
    false
  );
}

function isExecutionForGranuleId(taskInput, granuleId) {
  const executionGranuleId = get(
    taskInput,
    'payload.granules[0].granuleId'
  );

  return executionGranuleId === granuleId;
}

/**
 * Given a Cumulus Message and a granuleId, test if the message is a re-ingest
 * of the granule.
 *
 * This is used as the `findExecutionFn` parameter of the
 * `waitForTestExecutionStart` function.
 *
 * @param {Object} taskInput - a full Cumulus Message
 * @param {Object} findExecutionFnParams
 * @param {string} findExecutionFnParams.granuleId
 * @returns {boolean}
 */
function isReingestExecutionForGranuleId(taskInput, { granuleId }) {
  return isReingestExecution(taskInput) &&
    isExecutionForGranuleId(taskInput, granuleId);
}

module.exports = {
  isReingestExecutionForGranuleId,
  removeWorkflow,
  removeTaskFromWorkflow
};
