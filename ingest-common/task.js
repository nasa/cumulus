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

  /**
   * @param {integer} ms - The number of ms
   * @return true if execution must end within the given number of ms, false otherwise
   */
  endsWithin(ms) {
    return this.context.getRemainingTimeInMillis &&
           this.context.getRemainingTimeInMillis() < ms;
  }

  /**
   * Returns a connection configuration object read from the input config and provider.
   * This is appropriate to use, provided:
   * 1. The task reads the number of connections from config.connections
   * 2. The task must limit total connections for a single provider ID
   * 3. The provider is configured with global_connection_limit
   * @return - An object with the following fields:
   *           connections: The number of connections to use for the current task
   *           connection_group: A string identifying the globally-limited group of connections
   *           max_group_connections: The maximum number of connections to allow for the group
   *           connection_table: The DynamoDB table ARN to use for reserving connections
   */
  getConnectionConfig() {
    const provider = this.message.provider;
    return {
      connections: this.config.connections,
      connection_group: provider.id,
      max_group_connections: provider.config.global_connection_limit,
      connection_table: this.message.resources.tables.connections
    };
  }

  /**
   * Reserves connections as defined by getConnectionConfig(), runs fn, and then releases
   * the reserved connections.
   * @param {function} fn - The function to call with reserved connections
   * @return {*} The return value from calling fn
   * @throws {errors.ResourcesLockedError} if connections cannot be reserved
   */
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
    const responseStr = (response === null || response === undefined) ?
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
      await source.performLambdaCallback(this, callback, null, response);
      return response;
    }
    catch (error) {
      if (source) {
        try {
          await source.fail();
        }
        catch (e) {
          log.error('Failure failed', e.message, e.stack);
        }
      }

      if (errors.isWorkflowError(error)) {
        log.info(`Failing task due to workflow error ${error.name}`);
        log.info(error.stack);
        callback(null, { exception: error.name });
        return null;
      }

      this.logTaskError(error, startDate);

      callback(error.message, error.stack);

      return error;
    }
  }
};
