/**
 * Includes helper functions for replicating Step Function Workflows
 * locally
 */

'use strict';

const path = require('path');
const fs = require('fs-extra');
const clone = require('lodash.clonedeep');
const { randomString } = require('@cumulus/common/test-utils');
const { template } = require('@cumulus/deployment/lib/message');
const { fetchMessageAdapter } = require('@cumulus/deployment/lib/adapter');

/**
 * Download cumulus message adapter (CMA) and unzip it
 *
 * @param {string} version - cumulus message adapter version number (optional)
 * @returns {Promise.<Object>} an object with path to the zip and extracted CMA
 */
async function downloadCMA(version) {
  // download and unzip the message adapter
  const gitPath = 'nasa/cumulus-message-adapter';
  const filename = 'cumulus-message-adapter.zip';
  const src = path.join(process.cwd(), 'tests', `${randomString()}.zip`);
  const dest = path.join(process.cwd(), 'tests', randomString());
  await fetchMessageAdapter(version, gitPath, filename, src, dest);
  return {
    src,
    dest
  };
}

/**
 * Copy cumulus message adapter python folder to each task
 * in the workflow
 *
 * @param {Object} workflow - a test workflow object
 * @param {string} src - the path to the cumulus message adapter folder
 * @param {string} cmaFolder - the name of the folder where CMA is copied to
 * @returns {Promise.<Array>} an array of undefined values
 */
function copyCMAToTasks(workflow, src, cmaFolder) {
  return Promise.all(workflow.steps.map((step) => fs.copy(src, path.join(step.lambda, cmaFolder))));
}

/**
 * Delete cumulus message adapter from all tasks in the test workflow
 *
 * @param {Object} workflow - a test workflow object
 * @param {string} cmaFolder - the name of the folder where CMA is copied to
 * @returns {Promise.<Array>} an array of undefined values
 */
function deleteCMAFromTasks(workflow, cmaFolder) {
  return Promise.all(workflow.steps.map((step) => fs.remove(path.join(step.lambda, cmaFolder))));
}

/**
 * Build a cumulus message for a given workflow
 *
 * @param {Object} workflow - a test workflow object
 * @param {Object} configOverride - a cumulus config override object
 * @param {Array} cfOutputs - mocked outputs of a CloudFormation template
 * @returns {Object} the generated cumulus message
 */
function messageBuilder(workflow, configOverride, cfOutputs) {
  const workflowConfigs = {};
  workflow.steps.forEach((step) => {
    workflowConfigs[step.name] = step.cumulusConfig;
  });

  const config = {
    stack: 'somestack',
    workflowConfigs: {
      [workflow.name]: workflowConfigs
    }
  };
  Object.assign(config, configOverride);
  config.stackName = config.stack;

  const message = template(workflow.name, { States: workflowConfigs }, config, cfOutputs);
  message.cumulus_meta.message_source = 'local';
  message.cumulus_meta.system_bucket = config.system_bucket;
  return message;
}

/**
 * Runs a given workflow step (task)
 *
 * @param {string} lambdaPath - the local path to the task (e.g. path/to/task)
 * @param {string} lambdaHandler - the lambda handler (e.g. index.hanlder)
 * @param {Object} message - the cumulus message input for the task
 * @param {string} stepName - name of the step/task
 * @returns {Promise.<Object>} the cumulus message returned by the task
 */
async function runStep(lambdaPath, lambdaHandler, message, stepName) {
  const taskFullPath = path.join(process.cwd(), lambdaPath);
  const nextMessage = { ...message };
  const src = path.join(taskFullPath, 'adapter.zip');
  const dest = path.join(taskFullPath, 'cumulus-message-adapter');

  process.env.CUMULUS_MESSAGE_ADAPTER_DIR = dest;

  // add step name to the message
  nextMessage.cumulus_meta.task = stepName;

  try {
    // run the task
    const moduleFn = lambdaHandler.split('.');
    const moduleFileName = moduleFn[0];
    const moduleFunctionName = moduleFn[1];
    const task = require(`${taskFullPath}/${moduleFileName}`); // eslint-disable-line global-require, import/no-dynamic-require, max-len

    console.log(`Started execution of ${stepName}`);

    return new Promise((resolve, reject) => {
      task[moduleFunctionName](nextMessage, {}, (e, r) => {
        if (e) return reject(e);
        console.log(`Completed execution of ${stepName}`);
        return resolve(r);
      });
    });
  }
  finally {
    await fs.remove(src);
  }
}

/**
 * Executes a given workflow by running each step in the workflow
 * one after each other
 *
 * @param {Object} workflow - a test workflow object
 * @param {Object} message - input message to the workflow
 * @returns {Promise.<Object>} an object that includes the workflow input/output
 *  plus the output of every step
 */
async function runWorkflow(workflow, message) {
  const trail = {
    input: clone(message),
    stepOutputs: {},
    output: {}
  };

  let stepInput = clone(message);

  for (const step of workflow.steps) {
    stepInput = await runStep(step.lambda, step.handler, stepInput, step.name);
    trail.stepOutputs[step.name] = clone(stepInput);
  }
  trail.output = clone(stepInput);

  return trail;
}

module.exports = {
  downloadCMA,
  copyCMAToTasks,
  deleteCMAFromTasks,
  runStep,
  runWorkflow,
  messageBuilder
};
