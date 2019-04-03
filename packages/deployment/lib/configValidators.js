'use strict';

const get = require('lodash.get');
/**
 * @param  {Object} config kes configuration object
 *
 */
function validateWorkflowDefinedLambdas(config) {
  const lambdaResourceMatch = /\$\{(.*)LambdaFunction\.Arn\}/;
  const stepFunctions = get(config, 'stepFunctions', {});
  const stepFunctionValues = Object.values(stepFunctions).map((sf) => Object.values(sf.States));
  const lambdas = Object.keys(config.lambdas);

  let resources = [].concat(...stepFunctionValues).reduce((result, cfg) => {
    if (cfg.Type === 'Task') {
      const lambdaArnMatch = cfg.Resource.match(lambdaResourceMatch);
      if (lambdaArnMatch) {
        result.push(lambdaArnMatch[1]);
      }
    }
    return result;
  }, []);
  resources = [...new Set(resources)];
  resources.forEach((resource) => {
    if (!lambdas.includes(resource)) {
      console.log(`At failure for ${resource} lambdas was ${lambdas}`);
      throw new Error(`*** Error: Workflow lambda resource ${resource} not defined in lambda configuration`);
    }
  });
}

module.exports = validateWorkflowDefinedLambdas;
