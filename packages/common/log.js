'use strict';

/**
 * Constructs JSON to log
 *
 * @param {string} level - type of log (info, error, debug, warn)
 * @param {string} args - Message to log and any other information
 * @returns {undefined} - the JSON to be logged
 */
function log(level, args) {
  const executions = process.env.EXECUTIONS; //set in handler from cumulus_meta
  const sender = process.env.SENDER; //set in handler from AWS context
  const time = new Date();
  var message = '';

  const output = {
    executions: executions,
    timestamp: time.toISOString(),
    sender: sender,
    level: level
  };
  for (const arg of args) {
    if ((typeof arg) === 'string') message = message + arg + ' ';
    else {
      for (const key in arg) {
        output[key] = arg[key];
      }
    }
  }

  output.message = message;
  if (level === 'error') console.error(output);
  else console.log(output);
}

/**
 * Logs the message
 *
 * @param {string} args - Includes message and any other information to log
 * @returns {undefined} - the JSON to be logged
 */
function info(...args) {
  return log('info', args);
}

/**
 * Logs the error
 *
 * @param {Object} args - Includes error and any other information to log
 * @returns {undefined} - the JSON to be logged
 */
function error(...args) {
  log('error', args);
}

/**
 * Logs the debugger messsages
 *
 * @param {Object} args - Includes debugger message and any other information to log
 * @returns {undefined} - the JSON to be logged
 */
function debug(...args) {
  log('debug', args);
}

/**
 * Logs the Warning messsage
 *
 * @param {Object} args - Includes Warn message and any other information to log
 * @returns {undefined} - the JSON to be logged
 */
function warn(...args) {
  log('warn', args);
}

/**
 * Logs the Fatal messsage
 *
 * @param {Object} args - Includes Fatal message and any other information to log
 * @returns {undefined} - the JSON to be logged
 */
function fatal(...args) {
  log('fatal', args);
}
/**
 * Logs the Trace messsage
 *
 * @param {Object} args - Includes Trace message and any other information to log
 * @returns {undefined} - the JSON to be logged
 */
function trace(...args) {
  log('trace', args);
}

module.exports.info = info;
module.exports.error = error;
module.exports.debug = debug;
module.exports.warn = warn;
module.exports.fatal = fatal;
module.exports.trace = trace;
