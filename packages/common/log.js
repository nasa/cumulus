'use strict';

const Logger = require('@cumulus/logger');
const isNumber = require('lodash.isnumber');
const isString = require('lodash.isstring');

function logger() {
  return new Logger({
    asyncOperationId: process.env.ASYNCOPERATIONID,
    executions: process.env.EXECUTIONS,
    granules: process.env.GRANULES,
    parentArn: process.env.PARENTARN,
    sender: process.env.SENDER,
    stackName: process.env.STACKNAME,
    version: process.env.TASKVERSION
  });
}

/**
 * Constructs JSON to log
 *
 * @param {string} additionalKeys - Any additional key value pairs the user chooses to log
 * @param {string} args - Message to log and any other information
 * @returns {undefined} - log is printed to stdout, nothing is returned
 */
function logAdditionalKeys(additionalKeys, ...args) {
  logger().infoWithAdditionalKeys(additionalKeys, ...args);
}

/**
 * Logs the message
 *
 * @param {string} args - Includes message and any other information to log
 */
function info(...args) {
  logger().info(...args);
}

/**
 * Logs the error
 *
 * @param {Object} args - Includes error and any other information to log
 */
function error(...args) {
  logger().error(...args);
}

/**
 * Logs the debugger messsages
 *
 * @param {Object} args - Includes debugger message and any other information to log
 */
function debug(...args) {
  logger().debug(...args);
}

/**
 * Logs the Warning messsage
 *
 * @param {Object} args - Includes Warn message and any other information to log
 */
function warn(...args) {
  logger().warn(...args);
}

/**
 * Logs the Fatal messsage
 *
 * @param {Object} args - Includes Fatal message and any other information to log
 */
function fatal(...args) {
  logger().fatal(...args);
}
/**
 * Logs the Trace messsage
 *
 * @param {Object} args - Includes Trace message and any other information to log
 */
function trace(...args) {
  logger().trace(...args);
}

/**
 * convert log level from string to number or number to string
 *
 * @param {string/number} level - log level in string or number
 * @returns {number/string} - level in number or string
 */
function convertLogLevel(level) {
  const mapping = {
    fatal: 60,
    error: 50,
    warn: 40,
    info: 30,
    debug: 20,
    trace: 10
  };
  if (isString(level)) return mapping[level];
  if (isNumber(level)) return Object.keys(mapping).find((key) => mapping[key] === level);
  return undefined;
}

module.exports.info = info;
module.exports.error = error;
module.exports.debug = debug;
module.exports.warn = warn;
module.exports.fatal = fatal;
module.exports.trace = trace;
module.exports.convertLogLevel = convertLogLevel;
module.exports.logAdditionalKeys = logAdditionalKeys;
