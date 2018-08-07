'use strict';

const {
  extend
} = require('lodash');

const {
  loadYmlConfigFile,
  saveYmlConfig
} = require('./configUtils');

function updateLambdaConfiguration(lambdaConfigFileName, lambdaName, configJson) {
  const config = loadYmlConfigFile(lambdaConfigFileName);
  extend(config[lambdaName], configJson);
  saveYmlConfig(config, lambdaConfigFileName);
}
module.exports = { updateLambdaConfiguration };
