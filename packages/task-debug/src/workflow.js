const log = require('@cumulus/common/log');
const local = require('@cumulus/common/local-helpers');

const taskMap = {
  DiscoverPdr: 'discover-pdr',
  TriggerProcessPdrs: 'trigger-process-pdrs'
};

/**
 * Returns the path to the module for the given task name
 * @param {string} taskName The name of the task
 * @return {string} The path to the module
 */
const requirePathForTask = taskName => {
  const moduleName = taskMap[taskName];
  return `../../../cumulus/tasks/${moduleName}`;
};

/**
 * Run a task locally with given message and return ouptput message for next stage
 * @param {Function} handler Function that executes a task
 * @param {Function} invocation Function that returns the message for a task
 * @return {*} The result from the execution
 */
exports.runTask = (handler, invocation) => handler(invocation(), {}, result => result);

/**
 * Returns a function that provides the message for a task
 * @param {string} collectionId The id of the collection to use
 * @param {string} taskName The Step Function task class name to use
 * @param {Object} resources Map of resources, e.g., S3 buckets
 * @param {*} payload Value to use for the `payload` entry in the message
 * @param {string} configFile Path to yml configuration file
 * @return {Object} A function that takes no arguments and provides the message for a task
 */
exports.genMessage = (collectionId, taskName, resources = {}, payload = null, configFile = null) =>
  local.collectionMessageInput(
    collectionId,
    taskName,
    o =>
      Object.assign({}, o, {
        resources: resources,
        payload: payload
      }),
    configFile
  );

/**
 * Run a workflow
 * @param {string} collectionId The id of the collection
 * @param {Object} workflow A map containing a description of the workflow
 * @param {Object} resources A map containing the resources, e.g., S3 buckets
 * @param {string} configFile The path to the yml that defines configuration
 */
exports.runWorkflow = async (collectionId, workflow, resources = {}, configFile = null) => {
  let taskName = workflow.StartAt;
  let result = null;

  // Execute the workflow
  while (taskName) {
    const task = workflow.States[taskName];
    const taskClass = require(requirePathForTask(taskName));
    result = await exports.runTask(
      taskClass.handler,
      exports.genMessage(collectionId, taskName, resources, result, configFile)
    );

    taskName = task.Next;
  }

  return result;
};
