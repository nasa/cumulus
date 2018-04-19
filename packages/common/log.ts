'use strict';

import { format } from 'util';

/**
 * Constructs JSON to log and logs it
 *
 * @param {string} level type of log (info, error, debug, warn)
 * @param {Array<*>} args arguments to be passed to util.format()
 * @param {Object} additionalKeys any additional keys to log, can be null
 * @returns {undefined} a message is printed to stdout, nothing is returned
 */
function log(level: string, args: any[], additionalKeys: Object = {}) {
  const defaultOutput = {
    level,
    executions: process.env.EXECUTIONS,
    message: format.apply(null, args),
    timestamp: (new Date()).toISOString(),
    sender: process.env.SENDER
  };

  const output = Object.assign({}, additionalKeys, defaultOutput);
  const message = JSON.stringify(output);

  if (level === 'error') console.error(message);
  else console.log(message);
}

/**
 * Constructs JSON to log
 *
 * @param {Object} additionalKeys any additional keys to log, can be null
 * @param {Array<*>} args arguments to be passed to util.format()
 * @returns {undefined} a message is printed to stdout, nothing is returned
 */
export function logAdditionalKeys(additionalKeys: Object, ...args: any[]) {
  log('info', args, additionalKeys);
}

/**
 * Logs the message
 *
 * @param {Array<*>} args arguments to be passed to util.format()
 * @returns {undefined} a message is printed to stdout, nothing is returned
 */
export function info(...args: any[]) {
  return log('info', args);
}

/**
 * Logs the error
 *
 * @param {Array<*>} args arguments to be passed to util.format()
 * @returns {undefined} a message is printed to stdout, nothing is returned
 */
export function error(...args: any[]) {
  log('error', args);
}

/**
 * Logs the debugger messsages
 *
 * @param {Array<*>} args arguments to be passed to util.format()
 * @returns {undefined} a message is printed to stdout, nothing is returned
 */
export function debug(...args: any[]) {
  log('debug', args);
}

/**
 * Logs the Warning messsage
 *
 * @param {Array<*>} args arguments to be passed to util.format()
 * @returns {undefined} a message is printed to stdout, nothing is returned
 */
export function warn(...args: any[]) {
  log('warn', args);
}

/**
 * Logs the Fatal messsage
 *
 * @param {Array<*>} args arguments to be passed to util.format()
 * @returns {undefined} a message is printed to stdout, nothing is returned
 */
export function fatal(...args: any[]) {
  log('fatal', args);
}
/**
 * Logs the Trace messsage
 *
 * @param {Array<*>} args arguments to be passed to util.format()
 * @returns {undefined} a message is printed to stdout, nothing is returned
 */
export function trace(...args: any[]) {
  log('trace', args);
}
