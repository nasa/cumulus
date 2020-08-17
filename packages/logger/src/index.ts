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
  private readonly asyncOperationId: string | undefined;
  private readonly executions: string | undefined;
  private readonly granules: string | undefined;
  private readonly parentArn: string | undefined;
  private readonly pretty: boolean;
  private readonly sender: string;
  private readonly stackName: string | undefined;
  private readonly console: Console;
  private readonly version: string | undefined;

  constructor(options: LoggerConstructorOptions = {}) {
    this.asyncOperationId = options.asyncOperationId;
    this.executions = options.executions;
    this.granules = options.granules;
    this.parentArn = options.parentArn;
    this.pretty = options.pretty || false;
    this.sender = options.sender || 'unknown';
    this.stackName = options.stackName;
    this.console = options.console || global.console;
    this.version = options.version;
  }

  buildMessage(level: Level, ...messageArgs: any[]) {
    return this.buildLogEventMessage(level, messageArgs);
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
          message: error.message,
        },
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
  info(...messageArgs: any[]) {
    this.writeLogEvent('info', messageArgs);
  }

  /**
   * Log an event with additional properties
   *
   * @param {Object} additionalKeys
   * @param {Array<any>} messageArgs - the message to log
   */
  infoWithAdditionalKeys(additionalKeys: object, ...messageArgs: any[]) {
    this.writeLogEvent('info', messageArgs, additionalKeys);
  }

  /**
   * Log a trace message
   */
  trace(...messageArgs: any[]) {
    this.writeLogEvent('trace', messageArgs);
  }

  /**
   * Log a warning message
   */
  warn(...messageArgs: any[]) {
    this.writeLogEvent('warn', messageArgs);
  }

  private buildLogEventMessage(level: Level, messageArgs: any[], additionalKeys = {}) {
    let message: string;
    if (messageArgs.length === 0) {
      message = '';
    } else {
      message = util.format(messageArgs[0], ...messageArgs.slice(1));
    }

    const standardLogEvent = {
      asyncOperationId: this.asyncOperationId,
      executions: this.executions,
      granules: this.granules,
      level,
      message,
      parentArn: this.parentArn,
      sender: this.sender,
      stackName: this.stackName,
      timestamp: (new Date()).toISOString(),
      version: this.version,
    };

    const logEvent = {
      ...additionalKeys,
      ...standardLogEvent,
    };

    return this.pretty
      ? JSON.stringify(logEvent, undefined, 2)
      : JSON.stringify(logEvent);
  }

  private writeLogEvent(level: Level, messageArgs: any[], additionalKeys = {}) {
    const logEventString = this.buildLogEventMessage(
      level,
      messageArgs,
      additionalKeys
    );

    if (level === 'error') this.console.error(logEventString);
    else this.console.log(logEventString);
  }
}

export = Logger;
