'use strict';

const get = require('lodash.get');
const has = require('lodash.has');
const isObject = require('lodash.isObject');

/**
 * @param  {Object} config kes configuration object
 *
 */
function validateWorkflowDefinedLambdas(config) {
  if (!config.stepFunctions) {
    return;
  }

  const lambdaResourceMatch = /\$\{(.*)LambdaFunction\.Arn\}/;
  const stepFunctions = get(config, 'stepFunctions', {});
  const stepFunctionStates = Object.values(stepFunctions).map((sf) => Object.values(sf.States));
  const lambdas = Object.keys(config.lambdas);

  const resources = [].concat(...stepFunctionStates).reduce((result, cfg) => {
    if (cfg.Type === 'Task') {
      const lambdaArnMatch = cfg.Resource.match(lambdaResourceMatch);
      if (lambdaArnMatch && !result.includes(lambdaArnMatch[1])) {
        result.push(lambdaArnMatch[1]);
      }
    }
    return result;
  }, []);
  resources.forEach((resource) => {
    if (!lambdas.includes(resource)) {
      console.log(`At failure for ${resource} lambdas was ${lambdas}`);
      throw new Error(`*** Error: Workflow lambda resource ${resource} not defined in lambda configuration`);
    }
  });
}

/**
 * Validate config for SQS queues with a priority level defined.
 *
 * Throws an error if no corresponding priority config exists for a configured SQS
 * priority level.
 *
 * @param {Object} config kes configuration object
 * @throws {Error}
 */
function validatePriorityQueueConfig(config) {
  if (!config.sqs) return;
  const queueNames = Object.keys(config.sqs);

  queueNames.forEach((queueName) => {
    const queueConfig = config.sqs[queueName];
    if (queueConfig.priority && !has(config, `priority.${queueConfig.priority}`)) {
      throw new Error(`Config for ${queueName} references undefined priority ${queueConfig.priority}`);
    }
  });
}

/**
 * Validate config for priority levels.
 *
 * Throws an error if priority level config is not an object or if no maximum executions
 * is set for the priority level.
 *
 * @param {Object} config kes configuration object
 * @throws {Error}
 */
function validatePriorityLevelConfig(config) {
  if (!config.priority) return;
  const priorityLevels = Object.keys(config.priority);
  priorityLevels.forEach((priorityLevel) => {
    const priorityConfig = config.priority[priorityLevel];
    if (!isObject(priorityConfig)) {
      throw new Error(`Priority configuration for ${priorityLevel} must be an object`);
    }
    if (!priorityConfig.maxExecutions) {
      throw new Error(`Priority configuration for ${priorityLevel} must include a maxExecutions value`);
    }
  });
}

/**
 * Validate deployment configuration.
 *
 * @param {Object} config kes configuration object
 * @throws {Error}
 */
function validateConfig(config) {
  validateWorkflowDefinedLambdas(config);
  validatePriorityLevelConfig(config);
  validatePriorityQueueConfig(config);
}

module.exports = {
  validateWorkflowDefinedLambdas,
  validatePriorityLevelConfig,
  validatePriorityQueueConfig,
  validateConfig
};
