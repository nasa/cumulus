'use strict';

const readline = require('readline');
const aws = require('./aws');
const log = require('./log');

const EventSource = exports.EventSource = class {
  constructor() {
    this.messages = [];
  }

  async loadEventData() {
    if (this.eventData) {
      return Promise.resolve(this.eventData);
    }
    const json = await this.getEventScopedJson(this.eventName);
    if (this.originalEvent) {
      return Object.assign({}, this.originalEvent, json);
    }
    return json;
  }

  saveState(constructor, data) {
    return this.trigger(`${constructor.name}-state`, this.key, data);
  }

  loadState(constructor) {
    return this.getEventScopedJson(`${constructor.name}-state`)
               .catch(() => {
                 log.info('Existing state not loaded');
                 return null;
               });
  }

  await() {
    return Promise.all(this.messages);
  }

  complete() {
    return this.await();
  }

  fail() {
    return this.await();
  }

  retry() {
    log.error('Retry requested but not implemented');
    return this.await();
  }
};

class SqsS3EventSource extends EventSource {
  constructor(event) {
    super(event);
    this.queue = event.meta.queue;
    this.eventName = event.eventName;
    if (event.resources) {
      this.bucket = event.resources.buckets.private;
    }
    if (event.meta) {
      this.key = event.meta.key || event.meta.collection;
    }
    this.originalEvent = event;
  }

  static isSourceFor(event) {
    return event.eventQueueItem;
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

  async loadEventData() {
    const event = this.originalEvent;
    if (!event.payload || !event.payload.Bucket || !event.payload.Key) {
      return event;
    }
    const payloadJson = await aws.s3().getObject(event.payload).promise();
    return Object.assign({}, event, { payload: JSON.parse(payloadJson.Body) });
  }

  async getEventScopedJson(eventName) {
    if (!this.key) {
      return null;
    }
    const s3Config = {
      Bucket: this.bucket,
      Key: [eventName, this.key].join('/')
    };
    const data = await aws.s3().getObject(s3Config).promise();
    return JSON.parse(data.Body.toString());
  }

  trigger(eventName, key, data, delayMs = 0) {
    const scopedKey = [eventName, key].join('/');
    const params = {
      Bucket: this.bucket,
      Key: scopedKey,
      Body: JSON.stringify(data.payload) || '[]'
    };

    const promise = aws.promiseS3Upload(params).then(() => {
      const payload = { Bucket: params.Bucket, Key: params.Key };
      const eventData = Object.assign({}, data, { payload: payload, config: null });
      const queue = this.originalEvent.resources.eventQueues[eventName];
      log.info('Triggering', eventName, key, queue);
      return aws.sqs().sendMessage({
        MessageBody: JSON.stringify(eventData),
        QueueUrl: queue,
        DelaySeconds: delayMs / 1000,
        MessageAttributes: {
          event: {
            DataType: 'String',
            StringValue: eventName
          }
        }
      }).promise();
    });
    this.messages.push(promise);
    return promise;
  }

  async complete() {
    await this.await();
    const queueItem = this.originalEvent.eventQueueItem;
    if (queueItem) {
      await aws.sqs().deleteMessage(queueItem).promise();
      log.debug('Deleted source event');
    }
  }

  async fail(retryTimeoutMs = 30000) {
    await this.await();
    const queueItem = this.originalEvent.eventQueueItem;
    if (queueItem) {
      await aws.sqs().changeMessageVisibility(
        Object.assign({ VisibilityTimeout: retryTimeoutMs }, queueItem)
      ).promise();
      log.info(`Failed. Retrying in ${retryTimeoutMs / 1000}s`);
    }
  }

  async retry(retryTimeoutMs = 30000) {
    const data = Object.assign({}, this.originalEvent, { eventQueueItem: null });
    log.info(`Retrying in ${retryTimeoutMs / 1000}s`);
    await this.trigger(this.eventName, this.key, data, retryTimeoutMs);
    return await this.complete();
  }
}


class InlineEventSource extends EventSource {
  constructor(event) {
    super();
    this.eventData = event;
    if (event && event.transaction) {
      this.key = event.transaction.key;
    }
  }

  getEventScopedJson(eventName) {
    log.warn(`Not sent: InlineEventSource#getEventScopedJson("${eventName}")`);
    return Promise.resolve(null);
  }

  trigger(eventName, key, data) {
    const eventData = Object.assign({}, data, { config: null });
    log.warn(`inline-event: ${JSON.stringify([eventName, key, eventData])}`);
  }

  loadState(constructor) {
    return (this.eventData && this.eventData.state) ||
           this.getEventScopedJson(`${constructor.name}-state`)
               .catch(() => {
                 log.info('Existing state not loaded');
                 return null;
               });
  }

  static isSourceFor() {
    return true;
  }
}

class StdinEventSource extends InlineEventSource {
  constructor(event) {
    super();
    this.eventName = event.eventName;
    this.eventData = event;
    const events = [];
    this.callbacks = [];

    const rl = readline.createInterface({
      input: process.stdin
    });

    rl.on('line', (line) => {
      if (line.startsWith('[WARN] inline-event: ')) {
        const body = line.replace('[WARN] inline-event: ', '');
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
    const result = await this.getEventScopedJson(this.eventName);
    Object.assign(this.eventData, result);
    this.key = this.eventData.transaction.key;
    return this.eventData;
  }

  getEventScopedJsonImmediate(eventName) {
    for (const [name, , value] of this.events) {
      if (name === eventName) {
        if (this.eventData.config) {
          value.config = this.eventData.config;
        }
        return value;
      }
    }
    return null;
  }

  getEventScopedJson(eventName) {
    return new Promise((success) => {
      if (this.events) {
        success(this.getEventScopedJsonImmediate(eventName));
      }
      else {
        this.callbacks.push(() => {
          success(this.getEventScopedJsonImmediate(eventName));
        });
      }
    });
  }

  static isSourceFor(event) {
    return event.eventSource === 'stdin';
  }
}

exports.eventSources = [
  SqsS3EventSource,
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
  return new Source(event);
};
