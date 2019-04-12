'use strict';

const cloneDeep = require('lodash.clonedeep');
const readline = require('readline');

const aws = require('./aws');
const log = require('./log');
const { uuid } = require('./util');

// Maximum message payload size that will NOT be stored in S3. Anything bigger will be.
const MAX_NON_S3_PAYLOAD_SIZE = 10000;

/**
 * TODO Add docs
 */
class MessageSource {
  constructor(message, context) {
    this.messageData = message;
    this.messages = [];
    this.context = context;
  }

  loadMessageData() {
    return this.messageData;
  }

  loadConfigTemplate() {
    // Default implementation useful for local invocations
    const task = this.messageData.ingest_meta && this.messageData.ingest_meta.task;
    if (task) {
      return this.messageData.workflow_config_template[task];
    }
    throw new Error('No task configuration specified');
  }

  saveState(taskName, data) { // eslint-disable-line no-unused-vars
    log.warn('saveState requested but not implemented');
  }

  loadState(taskName) { // eslint-disable-line no-unused-vars
    log.warn('loadState requested but not implemented');
  }

  wait() {
    return Promise.all(this.messages);
  }

  complete() {
    return this.wait();
  }

  fail() {
    return this.wait();
  }

  performLambdaCallback(handler, callback, error, data) {
    callback(error, data);
  }

  retry() {
    log.error('Retry requested but not implemented');
    return this.wait();
  }
}
exports.MessageSource = MessageSource;

// Used when message size is too big for Lambda messages (32k)
class StateMachineS3MessageSource extends MessageSource {
  constructor(message, context) {
    super(message, context);
    this.originalMessage = message;

    if (message.resources) {
      this.bucket = message.resources.buckets.private;
    }
    if (message.meta) {
      this.key = message.meta.key || message.meta.collection;
    }
  }

  saveState(taskName, data) {
    const params = {
      Bucket: this.bucket,
      Key: [`${taskName}-state`, this.key].join('/'),
      Body: JSON.stringify(data)
    };
    const upload = aws.promiseS3Upload(params);
    this.messages.push(upload);
    return upload;
  }

  async loadConfigTemplate() {
    try {
      const workflowConfig = this.messageData.workflow_config_template;
      const meta = this.messageData.ingest_meta;
      log.info('Checking for arn mapping for ', this.context.invokedFunctionArn);
      if (workflowConfig.arns_to_name_mappings) {
        const match = workflowConfig.arns_to_name_mappings.find(({ arn }) =>
          arn === this.context.invokedFunctionArn);
        if (match) {
          log.info('Found configured task name', match.arn, ' -> ', match.name);
          return workflowConfig[match.name];
        }
      }
      const taskName = await aws.getCurrentSfnTask(meta.state_machine, meta.execution_name);
      log.debug(`TASK NAME is [${taskName}]`);
      return workflowConfig[taskName];
    } catch (e) {
      log.info('Exception in loadConfigTemplate');
      throw e;
    }
  }

  async loadState(taskName) {
    if (!this.key) {
      return null;
    }
    try {
      const s3Config = {
        Bucket: this.bucket,
        Key: [`${taskName}-state`, this.key].join('/')
      };
      const data = await aws.s3().getObject(s3Config).promise();

      return JSON.parse(data.Body.toString());
    } catch (e) {
      if (e.code !== 'NoSuchKey') {
        throw e;
      }
    }
    return null;
  }

  async loadMessageData() {
    try {
      const message = this.originalMessage;
      if (!message.payload || !message.payload.Bucket || !message.payload.Key) {
        return message;
      }
      const payloadJson = await aws.s3().getObject(message.payload).promise();
      return Object.assign({}, message, { payload: JSON.parse(payloadJson.Body) });
    } catch (e) {
      log.info('Exception in loadMessageData');
      throw e;
    }
  }

  static isSourceFor(message) {
    return message.ingest_meta.message_source === 'sfn';
  }

  performLambdaCallback(handler, callback, error, data) {
    if (error || (data && data.exception)) {
      callback(error, data);
      return error;
    }

    let returnValue;
    // Convert data to JSON to get a rough estimate of how big it will be in the message
    const jsonData = JSON.stringify(data);
    const roughDataSize = data ? jsonData.length : 0;
    log.debug(`PAYLOAD_SIZE: ${roughDataSize}`);

    if (roughDataSize < MAX_NON_S3_PAYLOAD_SIZE) {
      log.debug('Using standard payload');
      const message = Object.assign({}, this.originalMessage, { payload: data, exception: 'None' });
      callback(null, message);
      returnValue = Promise.resolve(null);
    } else {
      log.debug('Using S3 payload');
      const scopedKey = [handler.name, this.key, uuid()].join('/');
      const params = {
        Bucket: this.bucket,
        Key: scopedKey,
        Body: jsonData || '{}'
      };

      const promise = aws.promiseS3Upload(params).then(() => {
        const payload = { Bucket: params.Bucket, Key: params.Key };
        const messageData = Object.assign({},
          this.originalMessage,
          { payload: payload, exception: 'None' });
        log.info('Complete. Config uploaded to ', params.Key);
        callback(null, messageData);
      });
      this.messages.push(promise);
      returnValue = promise;
    }

    return returnValue;
  }
}

class InlineMessageSource extends MessageSource {
  static isSourceFor() {
    return true;
  }

  performLambdaCallback(handler, callback, error, data) {
    const outputData = Object.assign({}, this.messageData, { payload: data, exception: 'None' });
    if (!error) {
      log.warn('inline-result: ', JSON.stringify(outputData));
    }
    super.performLambdaCallback(handler, callback, error, outputData);
  }
}


// Instead of getting message from AWS, get message from stdin
class StdinMessageSource extends InlineMessageSource {
  constructor(message) {
    super(message);
    const messages = [];
    this.callbacks = [];

    const rl = readline.createInterface({
      input: process.stdin
    });

    rl.on('line', (line) => {
      if (line.startsWith('[WARN] inline-result: ')) {
        const body = line.replace('[WARN] inline-result: ', '');
        messages.push(JSON.parse(body));
      }
    });
    rl.on('close', () => {
      this.stdinMessages = messages;
      this.callbacks.forEach((callback) => callback());
    });
  }

  async loadMessageData() {
    const result = await this.getMessageScopedJson();
    Object.assign(this.messageData, result);
    return this.messageData;
  }

  getMessageScopedJsonImmediate() {
    if (this.stdinMessages.length === 0) return null;

    const value = cloneDeep(this.stdinMessages[0]);

    if (this.messageData.ingest_meta && this.messageData.ingest_meta.task) {
      value.ingest_meta = value.ingest_meta || {};
      value.ingest_meta.task = this.messageData.ingest_meta.task;
    }

    return value;
  }

  getMessageScopedJson() {
    return new Promise((resolve) => {
      if (this.stdinMessages) {
        resolve(this.getMessageScopedJsonImmediate());
      } else {
        this.callbacks.push(() => {
          resolve(this.getMessageScopedJsonImmediate());
        });
      }
    });
  }

  loadState() {
    return this.messageData && this.messageData.state;
  }

  static isSourceFor(message) {
    return message.ingest_meta.message_source === 'stdin';
  }
}


exports.messageSources = [
  StateMachineS3MessageSource,
  StdinMessageSource,
  InlineMessageSource
];


/**
 * Returns an appropriate message source for the given message
 * @param {Object} message - The incoming AWS Lambda message
 * @param {Object} context - The incoming AWS Lambda context
 * @param {Array} maybeSources - Message sources to use for lookup. If null,
 *   use exports.messageSources)
 * @returns {Source} A constructed MessageSource instance for the given message
 */
exports.forEvent = (message, context, maybeSources) => {
  const sources = maybeSources || exports.messageSources;

  const Source = sources.find((source) => source.isSourceFor(message));

  return new Source(message, context);
};
