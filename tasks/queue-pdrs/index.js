'use strict';

const get = require('lodash.get');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueParsePdrMessage } = require('@cumulus/ingest/queue');
const { getExecutionArn } = require('@cumulus/common/aws');

/**
* See schemas/input.json and schemas/config.json for detailed event description
*
* @param {Object} event - Lambda event object
* @returns {Promise} - see schemas/output.json for detailed output schema
*   that is passed to the next task in the workflow
**/
async function queuePdrs(event) {
  const pdrs = event.input.pdrs || [];
  const arn = getExecutionArn(
    get(event, 'cumulus_config.state_machine'), get(event, 'cumulus_config.execution_name')
  );
  const executionArns = await Promise.all(
    pdrs.map((pdr) => enqueueParsePdrMessage({
      pdr,
      queueUrl: event.config.queueUrl,
      parsePdrWorkflow: event.config.parsePdrWorkflow,
      provider: event.config.provider,
      collection: event.config.collection,
      parentExecutionArn: arn,
      stack: event.config.stackName,
      systemBucket: event.config.internalBucket
    }))
  );

  return { running: executionArns, pdrs_queued: pdrs.length };
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
