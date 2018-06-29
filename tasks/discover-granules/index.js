'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const granule = require('@cumulus/ingest/granule');
const log = require('@cumulus/common/log');

/**
* Discover granules
* See schemas/input.json and schemas/config.json for detailed event description
*
* @param {Object} event - Lambda event object
* @returns {Promise} - see schemas/output.json for detailed output schema
*   that is passed to the next task in the workflow
**/
async function discoverGranules(event) {
  const protocol = event.config.provider.protocol;

  const Discover = granule.selector('discover', protocol);
  const discover = new Discover(event);

  let granules;
  try {
    granules = await discover.discover();
  }
  catch (e) {
    log.error(`Discover granule exception: ${JSON.stringify(e)}`);
    throw e;
  }
  finally {
    if (discover.connected) discover.end();
  }

  if (granules) {
    log.info(`Discovered ${granules.length} granules.`);
  }
  else {
    log.info('Discovered no granules.');
  }

  return { granules };
}
exports.discoverGranules = discoverGranules;

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(discoverGranules, event, context, callback);
}
exports.handler = handler;
