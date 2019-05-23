'use strict';

const get = require('lodash.get');
const has = require('lodash.has');
const isObject = require('lodash.isobject');

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
 * Validate deployment configuration.
 *
 * @param {Object} config kes configuration object
 * @throws {Error}
 */
function validateConfig(config) {
  validateWorkflowDefinedLambdas(config);
}

module.exports = {
  validateWorkflowDefinedLambdas,
  validateConfig
};
