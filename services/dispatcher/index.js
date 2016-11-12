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

const pollQueue = async (url, invocation, handler) => {
  log.info('Polling', url);
  if (invocation.local) {
    try {
      await handler({ Body: JSON.stringify(invocation), Attributes: {} });
    }
    catch (err) {
      log.error('Polling failed: ', err.message);
      log.error(err.stack);
      throw err;
    }
    return;
  }
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
    pollQueue(url, invocation, handler);
  }
};

const startQueueDispatch = (fullEventName, queueUrl, globalListeners, invocation) => {
  pollQueue(queueUrl, invocation, async (message) => {
    const prefix = invocation.resources.stack;
    const event = JSON.parse(message.Body);
    const [eventName, subEventName] = fullEventName.split('_');

    let listeners = [];

    if (globalListeners) {
      listeners = listeners.concat(globalListeners);
    }

    if (event.collection) {
      const collection = event.collection;
      log.info(`Dispatching ${eventName} with collection ${collection.id}`);
      if (collection.hooks) {
        for (const hook of collection.hooks) {
          if (hook.event === eventName) {
            listeners.push(hook);
          }
        }
      }
    }
    else {
      log.info(`Dispatching ${eventName} with no collection`);
      // Get rid of listeners that can't be called
      listeners = listeners.filter((l) => l.configLocation);
    }

    listeners = listeners.map((listener) => Object.assign({}, listener));

    for (const listener of listeners) {
      if (listener.configLocation) {
        listener.config = event.collection[listener.configLocation];
        if (listener.config && listener.config.config) {
          listener.config = listener.config.config;
        }
      }
      if (listener.prefix) {
        for (const prop of ['queue', 'task']) {
          if (listener[prop]) listener[prop] += subEventName;
        }
      }
    }


    const key = event.transaction.key || event.transaction.collection || 'unknown';
    const suffix = event.transaction.startDate && event.transaction.startDate.replace(/:/g, '');
    event.resources.logs = {
      logGroupName: `${prefix}-transactions`,
      logStreamName: `${key}/${suffix}`
    };

    const queueItem = { QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle };
    for (const listener of listeners) {
      if (listener.task) {
        const payload = Object.assign({}, event, {
          eventName: fullEventName,
          eventQueueItem: queueItem,
          config: listener.config
        });

        const params = {
          FunctionName: `${prefix}-${listener.task}`,
          InvocationType: 'Event',
          Payload: JSON.stringify(payload)
        };
        const count = message.Attributes.ApproximateReceiveCount;
        log.info(`Dispatching ${fullEventName} to ${listener.task} (Attempt ${count})`);
        if (!invocation.local) {
          aws.lambda().invoke(params).promise()
             .then(() => log.info('Invocation succeeded'))
             .catch((err) => log.error('Invocation failed', err, err.stack));
        }
        else {
          log.debug('Payload', payload);
        }
      }
      else if (listener.queue) {
        const payload = Object.assign({}, event, {
          eventName: fullEventName,
          config: listener.config
        });
        const url = queueUrl.replace(`${fullEventName}-events`, listener.queue);
        log.info(`Dispatching to queue ${listener.queue}: ${url}`);
        try {
          await aws.sqs().sendMessage({
            MessageBody: JSON.stringify(payload),
            QueueUrl: url,
            MessageAttributes: message.MessageAttributes
          }).promise();
          aws.sqs().deleteMessage(queueItem).promise();
        }
        catch (e) {
          log.error(e, e.stack);
        }
      }
      else {
        log.error('Cannot dispatch', listener);
      }
    }
  });
};

module.exports.handler = async (invocation) => {
  try {
    const config = invocation.config;
    const events = JSON.parse(await aws.getPossiblyRemote(config.events));

    const eventQueues = invocation.resources.eventQueues;
    for (const eventName of Object.keys(eventQueues)) {
      const baseName = eventName.split('_')[0];
      startQueueDispatch(
        eventName,
        eventQueues[eventName],
        events.listeners[baseName],
        invocation
      );
    }
  }
  catch (err) {
    log.error('Dispatcher failed: ', err.message);
    log.error(err.stack);
    throw err;
  }
};

const local = require('gitc-common/local-helpers');

local.setupLocalRun(module.exports.handler, local.collectionEventInput(() => ({
  payload: { ohai: 'there' }
})));
