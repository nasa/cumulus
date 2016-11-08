'use strict';

const readline = require('readline');
const aws = require('./aws');
const log = require('./log');

class EventSource {
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
}

class S3EventSource extends EventSource {
  constructor(event) {
    super();
    if (event.Records) {
      const s3data = event.Records[0].s3;
      this.bucket = s3data.bucket.name;
      const keyPath = decodeURIComponent(s3data.object.key.replace(/\+/g, ' ')).split('/');
      this.eventName = keyPath.shift();
      this.key = keyPath.join('/');
    }
    else {
      this.eventName = event.eventName;
      if (event.transaction) {
        this.bucket = event.bucket;
        this.key = event.transaction.key;
      }
      this.originalEvent = event;
    }
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

  trigger(eventName, key, data) {
    const params = {
      Bucket: this.bucket,
      Key: [eventName, key].join('/'),
      Body: JSON.stringify(data)
    };
    const upload = aws.promiseS3Upload(params);
    this.messages.push(upload);
    return upload;
  }

  static isSourceFor(event) {
    return event.bucket ||
           (event.Records && event.Records[0] && event.Records[0].s3);
  }
}

class SqsS3EventSource extends S3EventSource {
  constructor(event) {
    super(event);
    this.queue = event.transaction.queue;
  }

  static isSourceFor(event) {
    return S3EventSource.isSourceFor(event) &&
           event.transaction && event.transaction.queue;
  }

  saveState(constructor, data) {
    return super.trigger(`${constructor.name}-state`, this.key, data);
  }

  trigger(eventName, key, data) {
    const scopedKey = [eventName, key].join('/');
    const params = {
      Bucket: this.bucket,
      Key: scopedKey,
      Body: JSON.stringify(data)
    };

    const promise = aws.promiseS3Upload(params).then(() => {
      const eventData = { transaction: data.transaction };
      log.info('Triggering', eventName, key, `${this.queue}${eventName}-events`);
      return aws.sqs().sendMessage({
        MessageBody: JSON.stringify(eventData),
        QueueUrl: `${this.queue}${eventName}-events`,
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
      log.info(`Retrying in ${retryTimeoutMs / 1000}s`);
    }
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

  trigger(...args) {
    log.warn(`inline-event: ${JSON.stringify(args)}`);
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
    return this.eventData;
  }

  getEventScopedJsonImmediate(eventName) {
    for (const [name, , value] of this.events) {
      if (name === eventName) {
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
  S3EventSource,
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
  return new Source(event);
};
