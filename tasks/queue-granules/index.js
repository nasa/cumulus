'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueGranuleIngestMessage } = require('@cumulus/ingest/queue');

/**
* See schemas/input.json and schemas/config.json for detailed event description
*
* @param {Object} event - Lambda event object
* @returns {Promise} - see schemas/output.json for detailed output schema
*   that is passed to the next task in the workflow
**/
async function queueGranules(event) {
  const granules = event.input.granules || [];

  const executionArns = await Promise.all(granules.map((granule) => enqueueGranuleIngestMessage(
    granule,
    event.config.queueUrl,
    event.config.granuleIngestMessageTemplateUri,
    event.config.provider,
    event.config.collection,
    event.input.pdr
  )));

  const result = { running: executionArns };
  if (event.input.pdr) result.pdr = event.input.pdr;
  return result;
}
exports.queueGranules = queueGranules;

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(queueGranules, event, context, callback);
}
exports.handler = handler;
