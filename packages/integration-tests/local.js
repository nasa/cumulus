/**
 * Includes helper functions for replicating Step Function Workflows
 * locally
 */
'use strict';

const path = require('path');
const fs = require('fs-extra');
const clone = require('lodash.clonedeep');
const { template } = require('@cumulus/deployment/lib/message');

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
  return Promise.all(
    workflow.steps.map(
      (step) => fs.copy(src, path.join(step.lambda, cmaFolder))
    )
  );
}

/**
 * Delete cumulus message adapter from all tasks in the test workflow
 *
 * @param {Object} workflow - a test workflow object
 * @param {string} cmaFolder - the name of the folder where CMA is copied to
 * @returns {Promise.<Array>} an array of undefined values
 */
function deleteCMAFromTasks(workflow, cmaFolder) {
  return Promise.all(
    workflow.steps.map(
      (step) => fs.remove(path.join(step.lambda, cmaFolder))
    )
  );
}

/**
 * Build a cumulus message for a given workflow
 *
 * @param {Object} workflow - a test workflow object
 * @param {Object} collection - the cumulus collection object
 * @param {Object} provider - the cumulus provider object
 * @param {string} bucket - the name of the s3 bucket used by system_bucket
 * @returns {Object} the generated cumulus message
 */
function messageBuilder(workflow, collection, provider, bucket) {
  const workflowConfigs = {}
  workflow.steps.forEach((step) => {
    workflowConfigs[step.name] = step.cumulusConfig;
  });

  const config = {
    buckets: {
      internal: bucket
    },
    stackName: 'somestack',
    workflowConfigs: {
      [workflow.name]: workflowConfigs
    }
  };

  const message = template(workflow.name, { States: workflowConfigs }, config, []);
  message.meta.provider = provider;
  message.meta.collection = collection;
  message.cumulus_meta.message_source = 'local';
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
  const src = path.join(taskFullPath, 'adapter.zip');
  const dest = path.join(taskFullPath, 'cumulus-message-adapter');
  let resp;

  process.env.CUMULUS_MESSAGE_ADAPTER_DIR = dest;

  // add step name to the message
  message.cumulus_meta.task = stepName;

  try {
    // add message adapter to task folder

    // run the task
    const moduleFn = lambdaHandler.split('.');
    const moduleFileName = moduleFn[0];
    const moduleFunctionName = moduleFn[1];
    const task = require(`${taskFullPath}/${moduleFileName}`);

    return new Promise((resolve, reject) => {
      task[moduleFunctionName](message, {}, (e, r) => {
        if (e) return reject(e);
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
 * @param {Object} collection - the cumulus collection object
 * @param {Object} provider - the cumulus provider object
 * @param {string} bucket - the name of the s3 bucket used by system_bucket
 * @returns {Promise.<Object>} an object that includes the workflow input/output
 *  plus the output of every step
 */
async function runWorkflow(workflow, collection, provider, bucket) {
  // build the input message
  const message = messageBuilder(workflow, collection, provider, bucket);
  const trail = {
    input: clone(message),
    stepOutputs: {},
    output: {}
  };

  let stepInput = clone(message);

  for (const step of workflow.steps) {
    stepInput = await runStep(step.lambda, step.handler, stepInput, step.name)
    trail.stepOutputs[step.name] = clone(stepInput);
  }
  trail.output = clone(stepInput);

  return trail;
}

module.exports = {
  copyCMAToTasks,
  deleteCMAFromTasks,
  runStep,
  runWorkflow
};
