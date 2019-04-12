/* eslint no-console: "off" */

'use strict';

const isError = require('lodash.iserror');
const { format } = require('util');

const privates = new WeakMap();

class Logger {
  /**
   * @param {Object} options - options object
   * @param {string} [options.sender="unknown"] - the sender of the log message
   * @param {string} [options.executions]
   * @param {Console} [options.console=global.console] - the console to write
   *   log events to
   * @param {string} [options.version]
   */
  constructor(options) {
    privates.set(
      this,
      {
        executions: options.executions,
        pretty: options.pretty || false,
        thisConsole: options.console || global.console,
        sender: options.sender || 'unknown',
        version: options.version
      }
    );
  }

  /**
   * Log a debug message
   *
   * @param {string} messageArgs - the message to log
   */
  debug(...messageArgs) {
    this._writeLogEvent('debug', messageArgs);
  }

  /**
   * Log an error message
   *
   * @param {string} messageArgs - the message to log
   */
  error(...messageArgs) {
    const lastMessageArg = messageArgs[messageArgs.length - 1];

    if (isError(lastMessageArg)) {
      const error = lastMessageArg;

      let actualMessageArgs = messageArgs.slice(0, messageArgs.length - 1);
      if (actualMessageArgs.length === 0) actualMessageArgs = [error.message];

      const additionalKeys = {
        error: {
          name: error.name,
          message: error.message
        }
      };
      if (error.stack) additionalKeys.error.stack = error.stack.split('\n');

      this._writeLogEvent(
        'error',
        actualMessageArgs,
        additionalKeys
      );
    } else {
      this._writeLogEvent('error', messageArgs);
    }
  }

  /**
   * Log a fatal message
   *
   * @param {string} messageArgs - the message to log
   */
  fatal(...messageArgs) {
    this._writeLogEvent('fatal', messageArgs);
  }

  /**
   * Log an info message
   *
   * @param {string} messageArgs - the message to log
   */
  info(...messageArgs) {
    this._writeLogEvent('info', messageArgs);
  }

  /**
   * Log an event with additional properties
   *
   * @param {Object} additionalKeys
   * @param {...any} messageArgs
   */
  infoWithAdditionalKeys(additionalKeys, ...messageArgs) {
    this._writeLogEvent('info', messageArgs, additionalKeys);
  }

  /**
   * Log a trace message
   *
   * @param {string} messageArgs - the message to log
   */
  trace(...messageArgs) {
    this._writeLogEvent('trace', messageArgs);
  }

  /**
   * Log a warning message
   *
   * @param {string} messageArgs - the message to log
   */
  warn(...messageArgs) {
    this._writeLogEvent('warn', messageArgs);
  }

  _writeLogEvent(level, messageArgs, additionalKeys = {}) {
    const {
      executions,
      pretty,
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

    const logEventString = pretty
      ? JSON.stringify(logEvent, null, 2)
      : JSON.stringify(logEvent);

    if (level === 'error') thisConsole.error(logEventString);
    else thisConsole.log(logEventString);
  }
}
module.exports = Logger;
