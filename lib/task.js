'use strict';

const log = require('./log');
const aws = require('./aws');
const messageSource = require('./message-source');
const FieldPattern = require('./field-pattern');
const concurrency = require('./concurrency');
const errors = require('./errors');

module.exports = class Task {
  constructor(source, config, message, context) {
    this.config = config;
    this.source = source;
    this.message = message;
    this.context = context;
  }

  endsWithin(ms) {
    return this.context.getRemainingTimeInMillis &&
           this.context.getRemainingTimeInMillis() < ms;
  }

  getConnectionConfig() {
    const provider = this.message.provider;
    return {
      connections: this.config.connections,
      connection_group: provider.id,
      max_group_connections: provider.config.global_connection_limit,
      connection_table: this.message.resources.tables.connections
    };
  }

  limitConnectionsFromConfig(fn) {
    const config = this.getConnectionConfig();
    if (!config.connections || !config.max_group_connections) {
      return fn();
    }
    const semaphore = new concurrency.Semaphore(aws.dynamodbDocClient(),
                                                config.connection_table);
    return semaphore.checkout(config.connection_group,
                              config.connections,
                              config.max_group_connections, fn);
  }

  run() {
    throw new Error('Task#run() is abstract');
  }

  static async invoke(task) {
    try {
      const response = await task.run();
      await task.source.complete();
      return response;
    }
    catch (err) {
      log.error('Failing job: ', err.message);
      await task.source.fail();
      throw err;
    }
  }

  /**
   * Logs the start of the Lambda handler along with its parameters
   * @param {object} event - The Lambda event object invoking the handler
   * @param {object} context - The Lambda context passed to the handler
   */
  static logHandlerStart(event, context) {
    log.info('Running handler');
    log.info('   Event:', JSON.stringify(event));
    log.info('   Context:', JSON.stringify(context));
  }

  /**
   * Logs the start of the task
   * @param {Task} task - The task to log
   * @param {object} context - The Lambda context passed to the handler
   */
  static logTaskStart(task) {
    log.info('   Config:', JSON.stringify(task.config));
    log.info('   Message:', JSON.stringify(task.message));
  }

  /**
   * Logs completion of the Task along with a truncated response
   * @param {*} response - The return value of the task
   * @param {Date} startDate - The time the task started
   * @param {integer} limit - The maximum number of response characters to log
   */
  static logTaskCompletion(response, startDate, limit = 2000) {
    const duration = (new Date() - startDate) / 1000;
    const responseStr = (response === null && response === undefined) ?
                        '(no response)' :
                        JSON.stringify(response, null, 2);
    log.info(`Processing Completed (${duration}s)`,
             responseStr.substring(0, limit),
             responseStr.length > limit ? '...' : '');
  }
  /**
   * Logs a fatal task error
   * @param {*} error - The thrown error
   * @param {Date} startDate - The time the task started
   */
  static logTaskError(error, startDate) {
    const duration = (new Date() - startDate) / 1000;
    log.error(`Task Failed (${duration}s):`, error);
    if (error.stack) {
      log.error(error.stack);
    }
    if (error.forEach) {
      error.forEach((e) => {
        if (e.stack) {
          log.error(e.stack);
        }
      });
    }
  }

  static async handle(event = {}, context = {}, callback = (() => null)) {
    const startDate = new Date();
    let source;
    try {
      this.logHandlerStart(event, context);
      // Load actual source data and unpack configuration from it
      source = messageSource.forEvent(event, context);
      const message = await source.loadMessageData();
      const configTemplate = await source.loadConfigTemplate();
      const config = FieldPattern.formatAll(configTemplate, message);

      // Create and invoke the task
      const task = new this(source, config, message, context);
      this.logTaskStart(task);
      const response = await this.invoke(task);
      this.logTaskCompletion(response, startDate);

      // Complete and pass on data to the next task
      return await source.performLambdaCallback(this, callback, null, response);
    }
    catch (error) {
      this.logTaskError(error, startDate);

      if (source) {
        try {
          source.fail();
        }
        catch (e) {
          log.error('Failure failed', e.message, e.stack);
        }
      }

      if (error instanceof errors.WorkflowError) {
        callback(null, { exception: error.name });
        return null;
      }

      callback(error.message, error.stack);
      return error;
    }
  }
};
