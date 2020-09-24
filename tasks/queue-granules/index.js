'use strict';

const get = require('lodash/get');
const omit = require('lodash/omit');
const pMap = require('p-map');
const { v4: uuidv4 } = require('uuid');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueGranuleIngestMessage } = require('@cumulus/ingest/queue');
const { buildExecutionArn } = require('@cumulus/message/Executions');
const CollectionConfigStore = require('@cumulus/collection-config-store');

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

  const arn = buildExecutionArn(
    get(event, 'cumulus_config.state_machine'), get(event, 'cumulus_config.execution_name')
  );

  const executionArns = await pMap(
    granules,
    async (granule) => {
      const collectionConfig = await collectionConfigStore.get(granule.dataType, granule.version);

      let executionName;
      if (granule.executionName) {
        executionName = granule.executionName;
      } else if (event.config.executionNamePrefix) {
        executionName = `${event.config.executionNamePrefix}-${uuidv4()}`;
      }

      return enqueueGranuleIngestMessage({
        granule: omit(granule, 'executionName'),
        queueUrl: event.config.queueUrl,
        granuleIngestWorkflow: event.config.granuleIngestWorkflow,
        provider: granule.provider || event.config.provider,
        collection: collectionConfig,
        pdr: event.input.pdr,
        parentExecutionArn: arn,
        stack: event.config.stackName,
        systemBucket: event.config.internalBucket,
        executionName,
      });
    },
    { concurrency: get(event, 'config.concurrency', 3) }
  );

  const result = { running: executionArns };
  if (event.input.pdr) result.pdr = event.input.pdr;
  return result;
}
exports.queueGranules = queueGranules;

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return cumulusMessageAdapter.runCumulusTask(queueGranules, event, context);
}
exports.handler = handler;
