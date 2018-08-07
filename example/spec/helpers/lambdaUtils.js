'use strict';

const { extend } = require('lodash');

const {
  loadYmlConfigFile,
  saveYmlConfigFile
} = require('./configUtils');

function updateLambdaConfiguration(lambdaConfigFileName, lambdaName, configJson) {
  const config = loadYmlConfigFile(lambdaConfigFileName);
  extend(config[lambdaName], configJson);
  saveYmlConfigFile(config, lambdaConfigFileName);
}
module.exports = { updateLambdaConfiguration };
