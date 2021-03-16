'use strict';

const get = require('lodash/get');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueWorkflowMessage } = require('@cumulus/ingest/queue');
const { buildExecutionArn } = require('@cumulus/message/Executions');

/**
* See schemas/input.json and schemas/config.json for detailed event description
*
* @param {Object} event - Lambda event object
* @returns {Promise} - see schemas/output.json for detailed output schema
*   that is passed to the next task in the workflow
**/
async function queueWorkflow(event) {
  const workflow = event.config.workflow || {};
  const workflowInput = event.config.workflowInput || {};
  const parentExecutionArn = buildExecutionArn(
    get(event, 'cumulus_config.state_machine'), get(event, 'cumulus_config.execution_name')
  );
  const executionArn = await enqueueWorkflowMessage({
    workflow,
    workflowInput: event.input,
    queueUrl: event.input.queueUrl || event.config.queueUrl,
    parentExecutionArn,
    provider: event.config.provider,
    collection: event.config.collection,
    stack: event.config.stackName,
    systemBucket: event.config.internalBucket,
    executionNamePrefix: event.config.executionNamePrefix,
    additionalCustomMeta: event.config.childWorkflowMeta,
  });

  return { running: executionArn, workflow, workflowInput };
}
exports.queueWorkflow = queueWorkflow;

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return cumulusMessageAdapter.runCumulusTask(queueWorkflow, event, context);
}
exports.handler = handler;
