/* eslint no-console: "off" */

'use strict';

const { format } = require('util');

const privates = new WeakMap();

class Logger {
  /**
   * @param {Object} options - options object
   * @param {string} options.sender - the sender of the log message
   * @param {string} [options.executions]
   * @param {Console} [options.console=global.console] - the console to write
   *   log events to
   * @param {string} [options.version]
   */
  constructor(options) {
    if (!options.sender) throw new TypeError('sender is required');

    privates.set(
      this,
      {
        executions: options.executions,
        thisConsole: options.console || global.console,
        sender: options.sender,
        version: options.version
      }
    );
  }

  /**
   * Log an info message
   *
   * @param {string} messageArgs - the message to log
   */
  info(...messageArgs) {
    this.writeLogEvent('info', messageArgs);
  }

  infoWithAdditionalKeys(additionalKeys, ...messageArgs) {
    this.writeLogEvent('info', messageArgs, additionalKeys);
  }

  /**
   * Log a debug message
   *
   * @param {string} messageArgs - the message to log
   */
  debug(...messageArgs) {
    this.writeLogEvent('debug', messageArgs);
  }

  /**
   * Log a warning message
   *
   * @param {string} messageArgs - the message to log
   */
  warn(...messageArgs) {
    this.writeLogEvent('warn', messageArgs);
  }

  /**
   * Log a trace message
   *
   * @param {string} messageArgs - the message to log
   */
  trace(...messageArgs) {
    this.writeLogEvent('trace', messageArgs);
  }

  /**
   * Log a fatal message
   *
   * @param {string} messageArgs - the message to log
   */
  fatal(...messageArgs) {
    this.writeLogEvent('fatal', messageArgs);
  }

  /**
   * Log an error message
   *
   * @param {string} messageArgs - the message to log
   */
  error(...messageArgs) {
    this.writeLogEvent('error', messageArgs);
  }

  writeLogEvent(level, messageArgs, additionalKeys = {}) {
    const {
      executions,
      sender,
      thisConsole,
      version
    } = privates.get(this);

    const standardLogEvent = {
      executions,
      level,
      message: format(...messageArgs),
      sender,
      timestamp: (new Date()).toISOString(),
      version
    };

    const logEvent = Object.assign(
      {},
      additionalKeys,
      standardLogEvent
    );

    const logEventString = JSON.stringify(logEvent);

    if (level === 'error') thisConsole.error(logEventString);
    else thisConsole.log(logEventString);
  }
}
module.exports = Logger;
