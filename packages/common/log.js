'use strict';

/**
 * Logs the stuff in the format we decided on
 *
 * @param {string} message - Message of log
 * @param {string} level - type of log (info, error)
 * @returns {JSON} - the JSON to be logged
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
  console.log(args);
  if (args.length === 1) message = args[0];
  else {
    for (const arg of args) {
      if ((typeof arg) === 'string') message += arg;
      else {
        for (const key in arg) {
          output[key] = arg[key];
        }
      }
    }
  }

  output.message = message;

  if (level === 'info') console.log(output);
  else console.err(output);
}

/**
 * Logs the message
 *
 * @param {string} message - Message of log
 * @returns {JSON} - the JSON to be logged
 */
function info(...args) {
  return log('info', args);
}

/**
 * Logs the error
 *
 * @param {Object} message - Error to log
 * @returns {JSON} - the JSON to be logged
 */
function error(...args) {
  log('error', args);
}

module.exports.info = info;
module.exports.error = error;
