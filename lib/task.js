'use strict';

const log = require('./log');
const aws = require('./aws');
const Mutex = require('./concurrency').Mutex;
const eventSource = require('./event-source');
const FieldPattern = require('./field-pattern');
const concurrency = require('./concurrency');

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

  run() {
    throw new Error('Task#run() is abstract');
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
    const table = this.event.resources.tables.locks;
    const mutex = new Mutex(aws.dynamodbDocClient(), table);
    return mutex.lock(key, timeout, fn);
  }

  static getEventName() {
    return this.name
               .replace(/[A-Z]/g, (char, index) => (index !== 0 ? '-' : '') + char.toLowerCase())
               .replace(/-task$/, '');
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
      log.info('Is Limited?', task.config && task.config.connections);
      if (task.config && task.config.connections) {
        const connections = task.config.connections;
        const providerConfig = task.event.provider;
        const max = providerConfig.config.global_connection_limit;
        const key = providerConfig.id;
        const table = task.event.resources.tables.connections;

        const onCheckout = () => this.invokeWithinLimits(task);
        const onFail = () => {
          log.error('Could not check out connections. Will retry.');
          return task.source.retry();
        };
        const semaphore = new concurrency.Semaphore(aws.dynamodbDocClient(), table);
        return await semaphore.checkout(key, connections, max, onCheckout, onFail);
      }
      return await this.invokeWithinLimits(task);
    }
    catch (err) {
      log.error('Failing job: ', err.message);
      await task.source.fail();
      throw err;
    }
  }

  static async invokeWithinLimits(task) {
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

  static async handle(event = {}, context = {}, callback = (() => null)) {
    const startDate = new Date();
    const logger = log;

    try {
      logger.info('Running', event, context, callback);
      const source = eventSource.forEvent(event, context);
      const [state, eventData] = await Promise.all([
        source.loadState(this),
        source.loadEventData()]);

      const configTemplate = await source.loadConfigTemplate();

      const config = FieldPattern.formatAll(configTemplate, event);
      const task = new this(source, config, state, eventData, context, logger);
      const response = await this.invoke(task);
      const duration = (new Date() - startDate) / 1000;
      logger.info(`Processing Completed (${duration}s)`);
      return await source.lambdaCallback(this, callback, null, response);
    }
    catch (error) {
      log.info('error?!?!', error);
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
