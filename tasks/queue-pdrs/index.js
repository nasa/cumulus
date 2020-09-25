'use strict';

const get = require('lodash/get');
const { v4: uuidv4 } = require('uuid');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueParsePdrMessage } = require('@cumulus/ingest/queue');
const { buildExecutionArn } = require('@cumulus/message/Executions');

/**
* See schemas/input.json and schemas/config.json for detailed event description
*
* @param {Object} event - Lambda event object
* @returns {Promise} - see schemas/output.json for detailed output schema
*   that is passed to the next task in the workflow
**/
async function queuePdrs(event) {
  const pdrs = event.input.pdrs || [];
  const arn = buildExecutionArn(
    get(event, 'cumulus_config.state_machine'), get(event, 'cumulus_config.execution_name')
  );
  const executionArns = await Promise.all(
    pdrs.map((pdr) => {
      const executionName = event.config.executionNamePrefix
        ? `${event.config.executionNamePrefix}-${uuidv4()}`
        : undefined;

      return enqueueParsePdrMessage({
        pdr,
        queueUrl: event.config.queueUrl,
        parsePdrWorkflow: event.config.parsePdrWorkflow,
        provider: event.config.provider,
        collection: event.config.collection,
        parentExecutionArn: arn,
        stack: event.config.stackName,
        systemBucket: event.config.internalBucket,
        executionName,
      });
    })
  );

  return { running: executionArns, pdrs_queued: pdrs.length };
}
exports.queuePdrs = queuePdrs;

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return cumulusMessageAdapter.runCumulusTask(queuePdrs, event, context);
}
exports.handler = handler;
