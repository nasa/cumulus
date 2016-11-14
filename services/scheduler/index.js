'use strict';

const aws = require('gitc-common/aws');
const log = require('gitc-common/log');
const collectionUtil = require('gitc-common/collections');

const startTimedIngest = (periodMs, offsetMs, invocation, collection) => {
  const run = async () => {
    try {
      const meta = JSON.parse(JSON.stringify(collection.meta || {}));
      const startDate = new Date().toISOString();
      const eventData = {
        resources: invocation.resources,
        collection: collection,
        meta: Object.assign(meta, { startDate: startDate }),
        transaction: Object.assign(meta, { startDate: startDate })
      };
      const event = `ingest-needed_${collection.ingest.source}`;
      const queue = invocation.resources.eventQueues[event];
      const message = JSON.stringify(eventData);
      log.info(`Initiating ${event} on ${queue}`);
      if (!invocation.local) {
        await aws.sqs().sendMessage({
          MessageBody: message,
          QueueUrl: queue,
          MessageAttributes: {
            event: {
              DataType: 'String',
              StringValue: event
            }
          }
        }).promise();
      }
    }
    catch (err) {
      log.error(err);
      log.error(err.stack);
    }
  };

  log.info(`Scheduling ${collection.id}. period=${periodMs}ms, offset=${offsetMs}ms`);
  if (invocation.local) {
    run();
  }
  else {
    setTimeout(() => {
      setInterval(run, periodMs);
      run();
    }, offsetMs);
  }
};

module.exports.handler = async (invocation) => {
  try {
    const config = invocation.config;

    const [collectionConfig, providerConfig] = await Promise.all([
      aws.getPossiblyRemote(config.collections),
      aws.getPossiblyRemote(config.providers)
    ]);

    const providers = collectionUtil.parseCollectionsByProvider(collectionConfig, providerConfig);

    for (const providerId of Object.keys(providers)) {
      const collections = providers[providerId];
      let offsetMs = 0;
      const staggerMs = 3 * 60 * 1000; // Stagger ingests by 3 minutes to limit concurrency
      for (const collection of collections) {
        const trigger = collection.trigger;
        if (trigger && trigger.type === 'timer' && collection.ingest) {
          const periodMs = 1000 * trigger.period_s;
          startTimedIngest(periodMs, offsetMs, invocation, collection);
          offsetMs += staggerMs;
        }
      }
    }
  }
  catch (err) {
    log.error('Scheduler failed: ', err.message);
    log.error(err.stack);
    throw err;
  }
};

const local = require('gitc-common/local-helpers');
local.setupLocalRun(module.exports.handler, local.taskInput);
