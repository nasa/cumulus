'use strict';

const { loadYmlFile } = require('./testUtils');

/**
 * Returns configuration object for entire configuration yml, or the top-level node
 * specified
 *
 * @param {string} configFilepath -config file path
 * @param {string} nodeName - workflow name
 * @returns {Object} return the workflow configuration
 */
module.exports.getConfigObject = (configFilepath, nodeName) => {
  const config = loadYmlFile(configFilepath);

  return nodeName ? config[nodeName] : config;
};
