'use strict';

/*
   Dispatches events as configured in /config/events.json

   The input event must take the following format:
   {
     event: { Key: keyname, Bucket: bucketname }, // events.json location
     products: { Key: keyname, Bucket: bucketname }, // products.json location
     prefix: "gitc-somestack" // The name of the stack (used to prefix resources)
   }

   Further, the context object must at least contain an invokedFunctionArn.
*/

const aws = require('gitc-common/aws');
const log = require('gitc-common/log');

const pollQueue = async (url, handler) => {
  try {
    const data = await aws.sqs().receiveMessage({
      QueueUrl: url,
      AttributeNames: ['All']
    }).promise();

    if (data && data.Messages) {
      for (const message of data.Messages) {
        handler(message);
      }
    }
  }
  catch (error) {
    log.error(error, error.stack);
  }
  finally {
    pollQueue(url, handler);
  }
};

const startQueueDispatch = (queueUrl, baseName, listeners, prefix, baseEvent = {}) => {
  pollQueue(queueUrl, async (message) => {
    if (!listeners) {
      log.warn('Unconfigured event:', baseName);
      return;
    }
    const event = JSON.parse(message.Body);
    const services = {};
    if (event.transaction) {
      const key = event.transaction.key || event.transaction.groupId || 'unknown';
      const suffix = event.transaction.startDate && event.transaction.startDate.replace(/:/g, '');
      services.cloudwatchlogs = {
        logGroupName: `${prefix}-transactions`,
        logStreamName: `${key}/${suffix}`
      };
    }
    const queueItem = { QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle };
    for (const listener of listeners) {
      if (listener.task) {
        const item = {
          eventName: baseName,
          eventQueueItem: queueItem,
          services: services
        };
        const payload = Object.assign({}, baseEvent, event, item);
        log.info(`Dispatching to task ${listener.task}`);
        const params = {
          FunctionName: `${prefix}-${listener.task}`,
          InvocationType: 'Event',
          Payload: JSON.stringify(payload)
        };
        const count = message.Attributes.ApproximateReceiveCount;
        log.info(`Dispatching ${baseName} to ${listener.task} (Attempt ${count})`);
        aws.lambda().invoke(params).promise()
           .then(() => log.info('Invocation succeeded'))
           .catch((err) => log.error('Invocation failed', err, err.stack));
      }
      else if (listener.queue) {
        const item = {
          eventName: baseName,
          services: services
        };
        const payload = Object.assign({}, baseEvent, event, item);
        log.info(`Dispatching to queue ${listener.queue}`);
        await aws.sqs().sendMessage({
          MessageBody: JSON.stringify(payload),
          QueueUrl: queueUrl.replace(baseName, listener.queue),
          MessageAttributes: message.MessageAttributes
        }).promise();
        aws.sqs().deleteMessage(queueItem).promise();
      }
      else {
        log.error('Cannot dispatch', listener);
      }
    }
  });
};

module.exports.handler = async (event, context) => {
  const eventsData = await aws.s3().getObject(event.events).promise();
  const eventConfig = JSON.parse(eventsData.Body.toString());
  const baseEvent = { prefix: event.prefix, bucket: event.bucket };
  for (const key of Object.keys(eventConfig.listeners)) {
    const url = aws.getQueueUrl(context.invokedFunctionArn, `${event.prefix}-${key}-events`);
    startQueueDispatch(url, key, eventConfig.listeners[key], event.prefix, baseEvent);
  }
};
