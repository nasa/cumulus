import isError = require('lodash.iserror');
import util = require('util');

type Level = 'debug' | 'error' | 'fatal' | 'info' | 'trace' | 'warn';

type LoggerConstructorOptions = {
  asyncOperationId?: string,
  console?: Console,
  executions?: string,
  granules?: string,
  parentArn?: string,
  pretty?: boolean,
  sender?: string,
  stackName?: string,
  version?: string
};

class Logger {
  readonly #asyncOperationId: string | undefined;
  readonly #executions: string | undefined;
  readonly #granules: string | undefined;
  readonly #parentArn: string | undefined;
  readonly #pretty: boolean;
  readonly #sender: string;
  readonly #stackName: string | undefined;
  readonly #console: Console;
  readonly #version: string | undefined;

  constructor(options: LoggerConstructorOptions = {}) {
    this.#asyncOperationId = options.asyncOperationId;
    this.#executions = options.executions;
    this.#granules = options.granules;
    this.#parentArn = options.parentArn;
    this.#pretty = options.pretty || false;
    this.#sender = options.sender || 'unknown';
    this.#stackName = options.stackName;
    this.#console = options.console || global.console;
    this.#version = options.version;
  }

  /**
   * Log a debug message
   */
  debug(...messageArgs: any[]) {
    this.writeLogEvent('debug', messageArgs);
  }

  /**
   * Log an error message
   */
  error(...messageArgs: any[]) {
    const lastMessageArg = messageArgs[messageArgs.length - 1];

    if (isError(lastMessageArg)) {
      const error = lastMessageArg;

      let actualMessageArgs = messageArgs.slice(0, messageArgs.length - 1);
      if (actualMessageArgs.length === 0) actualMessageArgs = [error.message];

      const additionalKeys: { error: { name: string, message: string, stack?: string[] }} = {
        error: {
          name: error.name,
          message: error.message
        }
      };
      if (error.stack) additionalKeys.error.stack = error.stack.split('\n');

      this.writeLogEvent(
        'error',
        actualMessageArgs,
        additionalKeys
      );
    } else {
      this.writeLogEvent('error', messageArgs);
    }
  }

  /**
   * Log a fatal message
   */
  fatal(...messageArgs: any[]) {
    this.writeLogEvent('fatal', messageArgs);
  }

  /**
   * Log an info message
   */
  info(...messageArgs: string[]) {
    this.writeLogEvent('info', messageArgs);
  }

  /**
   * Log an event with additional properties
   *
   * @param additionalKeys -
   * @param messageArgs - the message to log
   */
  infoWithAdditionalKeys(additionalKeys: object, ...messageArgs: any[]) {
    this.writeLogEvent('info', messageArgs, additionalKeys);
  }

  /**
   * Log a trace message
   */
  trace(...messageArgs: string[]) {
    this.writeLogEvent('trace', messageArgs);
  }

  /**
   * Log a warning message
   */
  warn(...messageArgs: string[]) {
    this.writeLogEvent('warn', messageArgs);
  }

  private writeLogEvent(level: Level, messageArgs: any[], additionalKeys = {}) {
    let message: string;
    if (messageArgs.length === 0) {
      message = '';
    } else {
      message = util.format(messageArgs[0], ...messageArgs.slice(1));
    }

    const standardLogEvent = {
      asyncOperationId: this.#asyncOperationId,
      executions: this.#executions,
      granules: this.#granules,
      level,
      message,
      parentArn: this.#parentArn,
      sender: this.#sender,
      stackName: this.#stackName,
      timestamp: (new Date()).toISOString(),
      version: this.#version
    };

    const logEvent = {
      ...additionalKeys,
      ...standardLogEvent
    };

    const logEventString = this.#pretty
      ? JSON.stringify(logEvent, null, 2)
      : JSON.stringify(logEvent);

    if (level === 'error') this.#console.error(logEventString);
    else this.#console.log(logEventString);
  }
}

export = Logger;
