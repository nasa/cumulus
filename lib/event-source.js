'use strict';

const readline = require('readline');
const aws = require('./aws');
const log = require('./log');

const EventSource = exports.EventSource = class {
  constructor(event, context) {
    this.eventData = event;
    this.messages = [];
    this.context = context;
  }

  loadEventData() {
    return this.eventData;
  }

  loadConfigTemplate() {
    // Default implementation useful for local invocations
    const task = this.eventData.ingest_meta && this.eventData.ingest_meta.task;
    if (task) {
      return this.eventData.workflow_config_template[task];
    }
    throw new Error('No task configuration specified');
  }

  saveState(constructor, data) { // eslint-disable-line no-unused-vars
    log.warn('saveState requested but not implemented');
  }

  loadState(constructor) {  // eslint-disable-line no-unused-vars
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
};

class StateMachineS3EventSource extends EventSource {
  constructor(event, context) {
    super(event, context);
    this.originalEvent = event;

    if (event.resources) {
      this.bucket = event.resources.buckets.private;
    }
    if (event.meta) {
      this.key = event.meta.key || event.meta.collection;
    }
  }

  saveState(constructor, data) {
    const params = {
      Bucket: this.bucket,
      Key: [`${constructor.name}-state`, this.key].join('/'),
      Body: JSON.stringify(data)
    };
    const upload = aws.promiseS3Upload(params);
    this.messages.push(upload);
    return upload;
  }

  async loadConfigTemplate() {
    const workflowConfig = this.eventData.workflow_config_template;
    const meta = this.eventData.ingest_meta;

    const taskName = await aws.getCurrentSfnTask(meta.state_machine, meta.execution_name);
    return workflowConfig[taskName];
  }

  async loadState(constructor) {
    if (!this.key) {
      return null;
    }
    try {
      const s3Config = {
        Bucket: this.bucket,
        Key: [`${constructor.name}-state`, this.key].join('/')
      };
      const data = await aws.s3().getObject(s3Config).promise();

      return JSON.parse(data.Body.toString());
    }
    catch (e) {
      if (e.code !== 'NoSuchKey') {
        throw e;
      }
    }
    return null;
  }

  async loadEventData() {
    const event = this.originalEvent;
    if (!event.payload || !event.payload.Bucket || !event.payload.Key) {
      return event;
    }
    const payloadJson = await aws.s3().getObject(event.payload).promise();
    return Object.assign({}, event, { payload: JSON.parse(payloadJson.Body) });
  }

  static isSourceFor(event) {
    return event.ingest_meta.event_source === 'sfn';
  }

  performLambdaCallback(handler, callback, error, data) {
    if (error) {
      callback(error, data);
      return error;
    }

    if (!data) {
      const message = Object.assign({}, this.originalEvent, { payload: data, exception: 'None' });
      callback(null, message);
    }

    const scopedKey = [handler.name, this.key].join('/');
    const params = {
      Bucket: this.bucket,
      Key: scopedKey,
      Body: JSON.stringify(data) || '{}'
    };

    const promise = aws.promiseS3Upload(params).then(() => {
      const payload = { Bucket: params.Bucket, Key: params.Key };
      const eventData = Object.assign({},
                                      this.originalEvent,
                                      { payload: payload, exception: 'None' });
      log.info('Complete. Config uploaded to ', params.Key);
      callback(null, eventData);
    });
    this.messages.push(promise);
    return promise;
  }
}

class InlineEventSource extends EventSource {
  static isSourceFor() {
    return true;
  }

  performLambdaCallback(handler, callback, error, data) {
    const outputData = Object.assign({}, this.eventData, { payload: data, exception: 'None' });
    if (!error) {
      log.warn('inline-result: ', JSON.stringify(outputData));
    }
    super.performLambdaCallback(handler, callback, error, outputData);
  }
}


class StdinEventSource extends InlineEventSource {
  constructor(event) {
    super(event);
    const events = [];
    this.callbacks = [];

    const rl = readline.createInterface({
      input: process.stdin
    });

    rl.on('line', (line) => {
      if (line.startsWith('[WARN] inline-result: ')) {
        const body = line.replace('[WARN] inline-result: ', '');
        events.push(JSON.parse(body));
      }
    });
    rl.on('close', () => {
      this.events = events;
      for (const callback of this.callbacks) {
        callback();
      }
    });
  }

  async loadEventData() {
    const result = await this.getEventScopedJson();
    Object.assign(this.eventData, result);
    return this.eventData;
  }

  getEventScopedJsonImmediate() {
    for (const value of this.events) {
      if (this.eventData.ingest_meta && this.eventData.ingest_meta.task) {
        value.ingest_meta = value.ingest_meta || {};
        value.ingest_meta.task = this.eventData.ingest_meta.task;
      }
      return value;
    }
    return null;
  }

  getEventScopedJson() {
    return new Promise((success) => {
      if (this.events) {
        success(this.getEventScopedJsonImmediate());
      }
      else {
        this.callbacks.push(() => {
          success(this.getEventScopedJsonImmediate());
        });
      }
    });
  }

  loadState() {
    return this.eventData && this.eventData.state;
  }

  static isSourceFor(event) {
    return event.ingest_meta.event_source === 'stdin';
  }
}


exports.eventSources = [
  StateMachineS3EventSource,
  StdinEventSource,
  InlineEventSource
];


exports.forEvent = (event, context, maybeSources) => {
  const sources = maybeSources || exports.eventSources;
  let Source;
  for (Source of sources) {
    if (Source.isSourceFor(event)) {
      break;
    }
  }
  log.info(`Using event source: ${Source.name}`);
  return new Source(event, context);
};
