'use strict';

const log = require('./log');
const CloudWatchLogger = require('./cloud-watch-logger');
const aws = require('./aws');
const Mutex = require('./concurrency').Mutex;
const eventSource = require('./event-source');
const FieldPattern = require('./field-pattern');
const delegates = require('./delegates');

module.exports = class Task {
  constructor(source, config, state, event, context) {
    this.config = config;
    this.source = source;
    this.stageStart = new Date();
    this.event = event;
    this.context = context;
    this.state = state;
  }

  logStageComplete(name) {
    const now = new Date();
    const duration = (now - this.stageStart) / 1000;
    log.info(`Stage "${name}" completed in ${duration}s`);
    this.stageStart = now;
  }

  endsWithin(ms) {
    return this.context.getRemainingTimeInMillis &&
           this.context.getRemainingTimeInMillis() < ms;
  }

  startTransactionLog() {
    this.event.transaction = this.event.transaction || {};
    this.event.transaction.isLogging = true;
    if (this.sigEventLogger.instance) {
      this.sigEventLogger.instance.unpause();
    }
  }

  run() {
    throw new Error('Task#run() is abstract');
  }

  trigger(eventName, key, data) {
    const event = Object.assign({ prefix: this.event.prefix }, data);
    return this.source.trigger(eventName, key, event);
  }

  saveState() {
    if (this.state) {
      return this.source.saveState(this.constructor, this.state);
    }
    return null;
  }

  loadState() {
    return this.source.loadState(this.constructor);
  }

  exclusive(key, timeout, fn) {
    const prefix = this.event.prefix;
    if (!prefix) {
      log.warn('No prefix, running without lock');
      return this.runExclusive();
    }
    const mutex = new Mutex(aws.dynamodbDocClient(), `${prefix}-locks`);
    return mutex.lock(key, timeout, fn);
  }

  get transactionKey() {
    return this.event.transaction.key;
  }

  static getEventName() {
    return this.name
               .replace(/[A-Z]/g, (char, index) => (index !== 0 ? '-' : '') + char.toLowerCase())
               .replace(/-task$/, '');
  }

  static async loadHandlerConfig(event) {
    let config;
    log.info('Loading config', event);
    if (event && event.collection && event.collection.stateConfig) {
      config = event.collection.stateConfig[this.getEventName()];
      log.info(`Loaded ${this.getEventName()}`, config);
    }
    else {
      config = event && event.config;
    }
    return config && FieldPattern.formatAll(config, event);
  }

  shouldRun() {
    return true;
  }

  static async invoke(task) {
    try {
      if (!task.shouldRun()) {
        log.info('Full execution not needed');
        await task.source.complete();
        throw new Error('NotNeeded');
      }
      if (this.logManager) {
        this.logManager.unpause();
      }
      const response = await task.run();
      task.saveState();
      await task.source.complete();
      const message = (response === null && response === undefined) ?
                      '(no response)' :
                      JSON.stringify(response, null, 2);
      if (message) {
        log.info('Job Complete: ',
                 message.substring(0, 2000),
                 message.length > 2000 ? '...' : '');
      }
      return response;
    }
    catch (err) {
      log.error('Failing job: ', err.message);
      await task.source.fail();
      throw err;
    }
  }

  static makeLogger(event) {
    let logger = log;
    if (event.services && event.services.cloudwatchlog) {
      const cwLogger = new CloudWatchLogger(event.services.cloudwatchlogs);
      logger = log.use(log.tagged(cwLogger.log, this.name, cwLogger));
      this.logManager = cwLogger;
      cwLogger.pause();
    }
    this.logger = logger;
    return logger;
  }

  static async handle(event = {}, context = {}, callback = (() => null)) {
    const startDate = new Date();
    const logger = this.makeLogger(event);

    try {
      if (this.delegate && context && context.via !== this.delegate) {
        delegates[this.delegate](event, context, callback);
        return { isRun: false, isDelegated: true };
      }

      logger.info('Running', event, context, callback);
      const source = eventSource.forEvent(event, context);
      const [state, eventData] = await Promise.all([
        source.loadState(this),
        source.loadEventData()]);

      const config = await this.loadHandlerConfig(eventData);
      const task = new this(source, config, state, eventData, context, logger);
      const response = await this.invoke(task);
      const duration = (new Date() - startDate) / 1000;
      logger.info(`Processing Completed (${duration}s)`);
      return await source.lambdaCallback(this, callback, null, response);
    }
    catch (error) {
      if (this.logManager) {
        this.logManager.unpause();
      }

      const handledErrors = ['NotNeeded', 'Incomplete'];
      if (handledErrors.indexOf(error.message) !== -1) {
        callback(null, { exception: error.message });
        return null;
      }

      const duration = (new Date() - startDate) / 1000;
      logger.error(`Task Failed (${duration}s):`, error);
      if (error.stack) {
        logger.error(error.stack);
      }
      if (error.forEach) {
        error.forEach((e) => {
          if (e.stack) {
            logger.error(e.stack);
          }
        });
      }
      callback(error.message, error.stack);
      return error;
    }
  }
};
