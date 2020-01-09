'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const log = require('@cumulus/common/log');
const GranuleDiscoverer = require('@cumulus/ingest/GranuleDiscoverer');

/**
 * Discovers granules. See schemas/input.json and schemas/config.json for
 * detailed event description.
 *
 * @param {Object} event - Lambda event object
 * @returns {Object} - see schemas/output.json for detailed output schema that
 *    is passed to the next task in the workflow
 */
async function discoverGranules(event) {
  const discoverer = new GranuleDiscoverer(event);

  try {
    const granules = await discoverer.discover();
    log.info(`Discovered ${granules.length} granules.`);
    return { granules };
  } finally {
    if (discoverer.connected) await discoverer.end();
  }
}

exports.discoverGranules = discoverGranules;

/**
 * Lambda handler.
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(discoverGranules, event, context,
    callback);
}

exports.handler = handler;
