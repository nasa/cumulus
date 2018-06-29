'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueParsePdrMessage } = require('@cumulus/ingest/queue');

/**
* See schemas/input.json and schemas/config.json for detailed event description
*
* @param {Object} event - Lambda event object
* @returns {Promise} - see schemas/output.json for detailed output schema
*   that is passed to the next task in the workflow
**/
async function queuePdrs(event) {
  const pdrs = event.input.pdrs || [];

  await Promise.all(
    pdrs.map((pdr) => enqueueParsePdrMessage(
      pdr,
      event.config.queueUrl,
      event.config.parsePdrMessageTemplateUri,
      event.config.provider,
      event.config.rule
    ))
  );

  return { pdrs_queued: pdrs.length };
}
exports.queuePdrs = queuePdrs;

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(queuePdrs, event, context, callback);
}
exports.handler = handler;
