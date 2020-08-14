import Logger from '@cumulus/logger';
import isNumber from 'lodash/isNumber';
import isString from 'lodash/isString';

function logger() {
  return new Logger({
    asyncOperationId: process.env.ASYNCOPERATIONID,
    executions: process.env.EXECUTIONS,
    granules: process.env.GRANULES,
    parentArn: process.env.PARENTARN,
    sender: process.env.SENDER,
    stackName: process.env.STACKNAME,
    version: process.env.TASKVERSION,
  });
}

/**
 * Constructs JSON to log
 *
 * @param {string} additionalKeys - Any additional key value pairs the user chooses to log
 * @param {string} args - Message to log and any other information
 * @returns {undefined} - log is printed to stdout, nothing is returned
 */
export function logAdditionalKeys(additionalKeys: object, ...args: any[]) {
  logger().infoWithAdditionalKeys(additionalKeys, ...args);
}

/**
 * Logs the message
 *
 * @param {string} args - Includes message and any other information to log
 */
export function info(...args: any[]) {
  logger().info(...args);
}

/**
 * Logs the error
 *
 * @param {Object} args - Includes error and any other information to log
 */
export function error(...args: any[]) {
  logger().error(...args);
}

/**
 * Logs the debugger messsages
 *
 * @param {Object} args - Includes debugger message and any other information to log
 */
export function debug(...args: any[]) {
  logger().debug(...args);
}

/**
 * Logs the Warning messsage
 *
 * @param {Object} args - Includes Warn message and any other information to log
 */
export function warn(...args: any[]) {
  logger().warn(...args);
}

/**
 * Logs the Fatal messsage
 *
 * @param {Object} args - Includes Fatal message and any other information to log
 */
export function fatal(...args: any[]) {
  logger().fatal(...args);
}
/**
 * Logs the Trace messsage
 *
 * @param {Object} args - Includes Trace message and any other information to log
 */
export function trace(...args: any[]) {
  logger().trace(...args);
}

/**
 * convert log level from string to number or number to string
 *
 * @param {string/number} level - log level in string or number
 * @returns {number/string} - level in number or string
 */
// @ts-ignore
export function convertLogLevel(level) {
  warn('@cumulus/common/log.convertLogLevel() is deprecated after version 1.23.2 and will be removed in a future release.');

  const mapping = {
    fatal: 60,
    error: 50,
    warn: 40,
    info: 30,
    debug: 20,
    trace: 10,
  };
  // @ts-ignore
  if (isString(level)) return mapping[level];
  // @ts-ignore
  if (isNumber(level)) return Object.keys(mapping).find((key) => mapping[key] === level);
  return undefined;
}
