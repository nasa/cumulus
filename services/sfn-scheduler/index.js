'use strict';

const _ = require('lodash');
const aws = require('gitc-common/aws');
const log = require('gitc-common/log');
const configUtil = require('gitc-common/config');

/**
 * Runs the given function at the given offset and with the given period thereafter
 *
 * @param {number} periodMs - The period (ms) at which to run the given fn
 * @param {number} offsetMs - The time offset (ms) at which to run the first invocation
 */
const doPeriodically = async (periodMs, offsetMs, fn) => {
  setTimeout(() => {
    setInterval(fn, periodMs);
    fn();
  }, offsetMs);
};

/**
 * Starts an ingest for the given collection
 * @param resources - An object with keys and values mapping meaningful resource names to external
 *                    URIs, ARNs, etc
 * @param provider - The provider configuration object for the collection's provider.
 * @param collection - Configuration for the collection to be ingested
 */
const triggerIngest = async (resources, provider, collection) => {
  try {
    const stateMachinePrefix = resources.state_machine_prefix;
    const stateMachine = `${stateMachinePrefix}_${collection.workflow}`;
    const meta = JSON.parse(JSON.stringify(collection.meta || {}));
    const startDate = new Date().toISOString();
    const eventData = {
      task_config: collection.task_config,
      resources: resources,
      provider: provider,
      ingest_meta: { event_source: 'sfn', start_date: startDate },
      meta: meta,
      exception: 'None',
      payload: null
    };

    const message = JSON.stringify(eventData);
    log.info(`Starting ingest of ${collection.id}`);
    await aws.sfn().startExecution({
      stateMachineArn: stateMachine,
      input: message,
      name: `${collection.id}-${startDate.split('.')[0].replace(/[:T]/g, '_')}`
    }).promise();
  }
  catch (err) {
    log.error(err);
    log.error(err.stack);
  }
};

const resolveResource = (cfResourcesById) =>
  (name) => {
    if (cfResourcesById[name]) return cfResourcesById[name];
    throw new Error(`Resource not found: ${name}`);
  };

/**
 * Starts a scheduler service that periodically triggers ingests described in config/collections.yml
 */
module.exports.handler = async (invocation) => {
  try {
    const cfParams = { StackName: invocation.resources.stack };
    const cfResources = await aws.cf().describeStackResources(cfParams).promise();
    const cfResourcesById = {};

    for (const cfResource of cfResources.StackResources) {
      log.info(cfResource);
      cfResourcesById[cfResource.LogicalResourceId] = cfResource.PhysicalResourceId;
    }

    const configStr = await aws.getPossiblyRemote(invocation.payload);
    const config = configUtil.parseConfig(configStr, resolveResource);

    const collectionsByProviderId = _.groupBy(config.collections, (c) => c.provider_id);

    for (const provider of config.providers) {
      const collections = collectionsByProviderId[provider.id];
      let offsetMs = 0;

      // Stagger collection ingests by 2.9 minutes to avoid overwhelming a provider
      // 2.9 is chosen because it's longer than a typical fetch cycle and also unlikely
      // to evenly divide normal NRT intervals and cause clashes in start time
      const staggerMs = 2.9 * 60 * 1000;

      for (const collection of collections) {
        const trigger = collection.trigger;
        if (trigger && trigger.type === 'timer') {
          const periodMs = 1000 * trigger.period_s;
          log.info(`Scheduling ${collection.id}.` +
                   `period=${periodMs}ms, offset=${offsetMs % periodMs}ms`);
          doPeriodically(periodMs, offsetMs % periodMs, () => {
            triggerIngest(invocation.resources, trigger.workflow, provider, collection);
          });
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

//const fs = require('fs');
//module.exports.handler({ resources: { stack: 'gitc-pq-sfn' },
//                         payload: fs.readFileSync('../config/collections.yml').toString() });
