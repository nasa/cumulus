'use strict';

const get = require('lodash.get');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueGranuleIngestMessage } = require('@cumulus/ingest/queue');
const { CollectionConfigStore } = require('@cumulus/common');
const { getExecutionArn } = require('@cumulus/common/aws');

/**
* See schemas/input.json and schemas/config.json for detailed event description
*
* @param {Object} event - Lambda event object
* @returns {Promise} - see schemas/output.json for detailed output schema
*   that is passed to the next task in the workflow
**/
async function queueGranules(event) {
  const granules = event.input.granules || [];

  const collectionConfigStore = new CollectionConfigStore(
    event.config.internalBucket,
    event.config.stackName
  );

  const arn = getExecutionArn(
    get(event, 'cumulus_config.state_machine'), get(event, 'cumulus_config.execution_name')
  );

  const executionArns = await Promise.all(
    granules.map(async (granule) => {
      const collectionConfig = await collectionConfigStore.get(granule.dataType, granule.version);
      return enqueueGranuleIngestMessage({
        granule,
        queueUrl: event.config.queueUrl,
        granuleIngestWorkflow: event.config.granuleIngestWorkflow,
        provider: event.config.provider,
        collection: collectionConfig,
        pdr: event.input.pdr,
        parentExecutionArn: arn,
        stack: event.config.stackName,
        systemBucket: event.config.internalBucket
      });
    })
  );

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
