'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const granule = require('@cumulus/ingest/granule');
const log = require('@cumulus/common/log');

/**
 * Discovers granules. See schemas/input.json and schemas/config.json for
 * detailed event description.
 *
 * @param {Object} event - Lambda event object
 * @returns {Object} - see schemas/output.json for detailed output schema that
 *    is passed to the next task in the workflow
 */
async function discoverGranules(event) {
  const protocol = event.config.provider.protocol;
  const Discoverer = granule.selector('discover', protocol);
  const discoverer = new Discoverer(event);

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
