'use strict';

/**
 * Logs the stuff in the format we decided on
 *
 * @param {string} message - Message of log
 * @param {string} level - type of log (info, error)
 * @returns {JSON} - the JSON to be logged
 */
function log(message, level) {
  const executions = process.env.EXECUTIONS; //set in handler from cumulus_meta
  const sender = process.env.SENDER; //set in handler from AWS context
  const time = new Date();

  const output = {
    executions: executions,
    timestamp: time.toISOString(),
    msg: message,
    sender: sender,
    level: level
  };
  if (level === 'info') console.log(output);
  else console.err(output);
}

/**
 * Logs the message
 *
 * @param {string} message - Message of log
 * @returns {JSON} - the JSON to be logged
 */
function info(message) {
  return log(message, 'info');
}

/**
 * Logs the error
 *
 * @param {Object} message - Error to log
 * @returns {JSON} - the JSON to be logged
 */
function error(message) {
  log(message, 'error');
}

module.exports.info = info;
module.exports.error = error;
