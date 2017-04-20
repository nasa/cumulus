'use strict';

const log = require('./log');
const aws = require('./aws');
const Mutex = require('./concurrency').Mutex;
const eventSource = require('./event-source');
const FieldPattern = require('./field-pattern');
const concurrency = require('./concurrency');
const errors = require('./errors');

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

  shouldRun() {
    return true;
  }

  static async invoke(task) {
    try {
      if (!task.shouldRun()) {
        log.info('Full execution not needed');
        await task.source.complete();
        throw new errors.NotNeededError();
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
    try {
      log.info('Running handler');
      log.info('   Event:', JSON.stringify(event, null, 2));
      log.info('   Context:', JSON.stringify(context));

      // Load actual source data and unpack configuration from it
      const source = eventSource.forEvent(event, context);
      const [state, eventData] = await Promise.all([
        source.loadState(this),
        source.loadEventData()]);

      const configTemplate = await source.loadConfigTemplate();

      const config = FieldPattern.formatAll(configTemplate, eventData);

      log.info('   Config:', JSON.stringify(config));
      log.info('   Loaded Event:', JSON.stringify(eventData));

      // Create and invoke the task
      const task = new this(source, config, state, eventData, context, log);
      const response = await this.invoke(task);

      // Complete and pass on data to the next task
      const duration = (new Date() - startDate) / 1000;
      log.info(`Processing Completed (${duration}s)`);
      return await source.performLambdaCallback(this, callback, null, response);
    }
    catch (error) {
      if (error instanceof errors.NotNeededError ||
          error instanceof errors.IncompleteError) {
        callback(null, { exception: error.name });
        return null;
      }

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
      callback(error.message, error.stack);
      return error;
    }
  }
};
