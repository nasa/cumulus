'use strict';

const _ = require('lodash');
const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const sf = require('@cumulus/common/step-functions');
const configUtil = require('@cumulus/common/config');

/**
 * Runs the given function at the given offset and with the given period thereafter
 *
 * @param {number} periodMs - The period (ms) at which to run the given fn
 * @param {number} offsetMs - The time offset (ms) at which to run the first invocation
 * @param {function} fn - The function to call
 */
const doPeriodically = (periodMs, offsetMs, fn) => {
  setTimeout(() => {
    setInterval(fn, periodMs);
    fn();
  }, offsetMs);
};

/**
 * Starts an ingest for the given collection
 * @param {object} resources - An object with keys and values mapping meaningful resource names
 *                             to external URIs, ARNs, etc
 * @param {object} provider - The provider configuration object for the collection's provider.
 * @param {object} collection - Configuration for the collection to be ingested
 */
const triggerIngest = async (resources, provider, collection) => {
  try {
    const messageData = sf.constructStepFunctionInput(resources, provider, collection);
    const stateMachine = collection.workflow;
    const executionName = messageData.ingest_meta.execution_name;

    const message = JSON.stringify(messageData);
    log.info(`Starting ingest of ${collection.name}`);
    await aws.sfn().startExecution({
      stateMachineArn: stateMachine,
      input: message,
      name: executionName
    }).promise();
  }
  catch (err) {
    log.error(err);
    log.error(err.stack);
  }
};

/**
 * Starts a scheduler service that periodically triggers ingests described in config/collections.yml
 * @param {MessageEnvelope} invocation - Configuration and resources for the scheduler
 */
module.exports.handler = async (invocation) => {
  try {
    const cfParams = { StackName: invocation.resources.stack };
    const cfResources = await aws.cf().describeStackResources(cfParams).promise();
    const cfResourcesById = {};
    const prefix = invocation.resources.state_machine_prefix;

    for (const cfResource of cfResources.StackResources) {
      cfResourcesById[cfResource.LogicalResourceId] = cfResource;
    }

    const configStr = await aws.getPossiblyRemote(invocation.payload);
    const resolver = configUtil.resolveResource(cfResourcesById, prefix);
    const config = configUtil.parseConfig(configStr, resolver);

    // Update the keys under the workflows to map identifiers (Arns) to workflow
    config.workflows = _.mapKeys(config.workflows, (v, k) => resolver(k));

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
        if (trigger && trigger.type === 'interval') {
          const periodMs = 1000 * trigger.period_s;
          log.info(`Scheduling ${collection.name}.` +
                   `period=${periodMs}ms, offset=${offsetMs % periodMs}ms`);
          doPeriodically(periodMs, offsetMs % periodMs, () => {
            triggerIngest(invocation.resources, provider, collection);
          });
          offsetMs += staggerMs;
        }
        else if (trigger && trigger.type === 'once') {
          triggerIngest(invocation.resources, provider, collection);
        }
      }
    }
    // Run a heartbeat function to avoid terminating
    setInterval((() => null), 10000000);
  }
  catch (err) {
    log.error('Scheduler failed: ', err.message);
    log.error(err.stack);
    throw err;
  }
};

const localHelpers = require('@cumulus/common/local-helpers');
const fs = require('fs');
if (localHelpers.isLocal) {
  const stack = process.argv[3];
  const prefix = `${stack.replace(/\W/, 'x')}xx`;
  module.exports.handler({
    resources: { state_machine_prefix: prefix, stack: stack },
    payload: fs.readFileSync('../config/collections.yml').toString()
  });
}
